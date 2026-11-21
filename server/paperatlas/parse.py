"""Identify a DOI, arXiv id, OpenAlex id, Semantic Scholar id, URL, or title."""

from __future__ import annotations

import re

DOI_RE = re.compile(
    r"(?:doi:\s*|https?://(?:dx\.)?doi\.org/)?"
    r"(10\.\d{4,9}/[-._;()/:A-Z0-9]+)",
    re.IGNORECASE,
)
ARXIV_URL_RE = re.compile(
    r"arxiv\.org/(?:abs|pdf|html)/"
    r"([a-z-]+(?:\.[a-z-]+)?/\d{7}|\d{4}\.\d{4,5})(v\d+)?",
    re.IGNORECASE,
)
ARXIV_TAG_RE = re.compile(
    r"arxiv:\s*([a-z-]+(?:\.[a-z-]+)?/\d{7}|\d{4}\.\d{4,5})(v\d+)?",
    re.IGNORECASE,
)
ARXIV_DOI_RE = re.compile(r"10\.48550/arxiv\.(\d{4}\.\d{4,5})", re.IGNORECASE)
ARXIV_BARE_RE = re.compile(r"\d{4}\.\d{4,5}(v\d+)?$", re.IGNORECASE)
OPENALEX_URL_RE = re.compile(r"openalex\.org/(W\d{8,})", re.IGNORECASE)
OPENALEX_BARE_RE = re.compile(r"W\d{8,}$", re.IGNORECASE)
S2_RE = re.compile(
    r"semanticscholar\.org/paper/(?:[^/\s]+/)?([a-f0-9]{20,40})",
    re.IGNORECASE,
)


def _clean_doi(doi: str) -> str:
    return re.sub(r"[.,;:)>\]]+$", "", doi).lower()


def find_doi(text: str) -> str | None:
    match = DOI_RE.search(text or "")
    if not match:
        return None
    return _clean_doi(match.group(1))


def find_arxiv(text: str, *, bare: bool) -> str | None:
    source = text or ""
    match = ARXIV_URL_RE.search(source) or ARXIV_TAG_RE.search(source)
    if match:
        return match.group(1)
    match = ARXIV_DOI_RE.search(source)
    if match:
        return match.group(1)
    stripped = source.strip()
    if bare and ARXIV_BARE_RE.fullmatch(stripped):
        return re.sub(r"v\d+$", "", stripped, flags=re.IGNORECASE)
    return None


def find_openalex(text: str) -> str | None:
    source = text or ""
    match = OPENALEX_URL_RE.search(source)
    if match:
        return match.group(1).upper()
    stripped = source.strip()
    if OPENALEX_BARE_RE.fullmatch(stripped):
        return stripped.upper()
    return None


def find_s2(text: str) -> str | None:
    match = S2_RE.search(text or "")
    if not match:
        return None
    return match.group(1).lower()


def parse_query(query: str) -> dict:
    """Classify user input. DOI and arXiv win over a surrounding citation string."""
    raw = re.sub(r"\s+", " ", (query or "").strip())
    if not raw:
        return {"kind": "invalid", "value": "", "raw": raw}

    doi = find_doi(raw)
    doi_explicit = (
        "doi.org" in raw.lower()
        or raw.lower().startswith("10.")
        or raw.lower().startswith("doi:")
    )
    if doi and (doi_explicit or len(raw) < 180):
        return {"kind": "doi", "value": doi, "raw": raw}

    arxiv = find_arxiv(raw, bare=True)
    if arxiv:
        return {"kind": "arxiv", "value": arxiv, "raw": raw}

    openalex = find_openalex(raw)
    if openalex:
        return {"kind": "openalex", "value": openalex, "raw": raw}

    s2 = find_s2(raw)
    if s2:
        return {"kind": "s2", "value": s2, "raw": raw}

    if raw.lower().startswith(("http://", "https://")):
        return {"kind": "url", "value": raw, "raw": raw}

    if doi:
        return {"kind": "doi", "value": doi, "raw": raw}

    return {"kind": "title", "value": raw, "raw": raw}
