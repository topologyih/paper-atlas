"""Read a title, DOI, or arXiv id from the first pages of an uploaded PDF."""

from __future__ import annotations

import io
import re

from .parse import find_arxiv, find_doi


def query_from_text(text: str) -> dict:
    head = text or ""
    doi = find_doi(head[:6000])
    if doi:
        return {"kind": "doi", "value": doi, "raw": doi, "excerpt": head[:500]}
    arxiv = find_arxiv(head[:2500], bare=False)
    if arxiv:
        return {"kind": "arxiv", "value": arxiv, "raw": arxiv, "excerpt": head[:500]}
    title = _guess_title(head)
    if title:
        return {"kind": "title", "value": title, "raw": title, "excerpt": head[:500]}
    return {"kind": "invalid", "value": "", "raw": "", "excerpt": head[:500]}


def _guess_title(text: str) -> str | None:
    bad = re.compile(
        r"^(abstract|introduction|arxiv:|doi:|www\.|http|proceedings|copyright|vol\.|pp\.|keywords)",
        re.IGNORECASE,
    )
    lines = []
    for line in (text or "").splitlines():
        cleaned = re.sub(r"\s+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
    candidates = []
    for line in lines[:25]:
        if bad.search(line) or "@" in line:
            continue
        if len(line) < 12 or len(line) > 220:
            continue
        letters = sum(character.isalpha() for character in line)
        if letters < 8:
            continue
        candidates.append(line)
    if not candidates:
        return None
    return max(candidates[:8], key=len)


def extract_pdf(data: bytes) -> dict:
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("PDF 超过 20 MB")
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise RuntimeError("缺少 pypdf。请先安装 server/requirements.txt。") from error
    reader = PdfReader(io.BytesIO(data))
    texts = []
    for page in reader.pages[:2]:
        texts.append(page.extract_text() or "")
    return query_from_text("\n".join(texts))
