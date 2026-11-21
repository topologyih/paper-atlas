"""Crossref, arXiv, and Semantic Scholar lookups used when OpenAlex search is unavailable."""

from __future__ import annotations

import html
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from .parse import find_arxiv, find_doi


def _get(url: str, headers: dict | None = None, timeout: int = 40) -> bytes:
    request = urllib.request.Request(url, headers=headers or {"User-Agent": "PaperAtlas/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def crossref_by_doi(doi: str) -> dict | None:
    url = "https://api.crossref.org/works/" + urllib.parse.quote(doi)
    mailto = os.environ.get("OPENALEX_MAILTO") or "paper-atlas@localhost"
    try:
        payload = json.loads(
            _get(url, {"User-Agent": f"PaperAtlas/1.0 (mailto:{mailto})", "Accept": "application/json"})
        )
    except Exception:
        return None
    return (payload or {}).get("message") or None


def crossref_search(title: str, rows: int = 5) -> list[dict]:
    mailto = os.environ.get("OPENALEX_MAILTO") or "paper-atlas@localhost"
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(
        {"query.bibliographic": title, "rows": str(rows)}
    )
    try:
        payload = json.loads(
            _get(url, {"User-Agent": f"PaperAtlas/1.0 (mailto:{mailto})", "Accept": "application/json"})
        )
    except Exception:
        return []
    return ((payload or {}).get("message") or {}).get("items") or []


def semantic_scholar_paper(paper_id: str) -> dict | None:
    url = (
        "https://api.semanticscholar.org/graph/v1/paper/"
        + urllib.parse.quote(paper_id)
        + "?fields=title,year,externalIds,citationCount,authors,abstract,url,venue"
    )
    key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")
    headers = {"User-Agent": "PaperAtlas/1.0"}
    if key:
        headers["x-api-key"] = key
    try:
        return json.loads(_get(url, headers))
    except Exception:
        return None


def semantic_scholar_search(title: str, limit: int = 5) -> list[dict]:
    url = "https://api.semanticscholar.org/graph/v1/paper/search?" + urllib.parse.urlencode(
        {"query": title, "limit": str(limit), "fields": "title,year,externalIds,citationCount,authors,url"}
    )
    key = os.environ.get("SEMANTIC_SCHOLAR_API_KEY", "")
    headers = {"User-Agent": "PaperAtlas/1.0"}
    if key:
        headers["x-api-key"] = key
    try:
        payload = json.loads(_get(url, headers))
    except Exception:
        return []
    return payload.get("data") or []


def fetch_text(url: str, timeout: int = 30) -> str:
    return _get(
        url,
        {"User-Agent": "PaperAtlas/1.0", "Accept": "text/html,application/xml,application/json"},
        timeout=timeout,
    ).decode("utf-8", "replace")


def meta_content(page: str, name: str) -> str | None:
    pattern = re.compile(
        rf'<meta[^>]+(?:name|property)=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)["\']',
        re.IGNORECASE,
    )
    match = pattern.search(page)
    if match:
        return html.unescape(match.group(1)).strip()
    pattern = re.compile(
        rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']{re.escape(name)}["\']',
        re.IGNORECASE,
    )
    match = pattern.search(page)
    if match:
        return html.unescape(match.group(1)).strip()
    return None


def identifiers_from_page(url: str) -> dict:
    try:
        page = fetch_text(url)
    except Exception as error:
        return {"error": str(error), "doi": None, "arxiv": None, "title": None}
    head = page[:12000]
    doi = find_doi(meta_content(head, "citation_doi") or "") or find_doi(head)
    arxiv = find_arxiv(meta_content(head, "citation_arxiv_id") or "", bare=True) or find_arxiv(head[:4000], bare=False)
    title = meta_content(head, "citation_title") or meta_content(head, "og:title")
    return {"error": None, "doi": doi, "arxiv": arxiv, "title": title}


def arxiv_entry(arxiv_id: str) -> dict | None:
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({"id_list": arxiv_id})
    try:
        payload = _get(url, {"User-Agent": "PaperAtlas/1.0"})
    except Exception:
        return None
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return None
    ns = {"a": "http://www.w3.org/2005/Atom"}
    entry = root.find("a:entry", ns)
    if entry is None:
        return None
    title = " ".join((entry.findtext("a:title", default="", namespaces=ns) or "").split())
    summary = " ".join((entry.findtext("a:summary", default="", namespaces=ns) or "").split())
    published = entry.findtext("a:published", default="", namespaces=ns) or ""
    year = int(published[:4]) if published[:4].isdigit() else None
    authors = []
    for author in entry.findall("a:author", ns):
        name = (author.findtext("a:name", default="", namespaces=ns) or "").strip()
        if name:
            authors.append(name)
    doi = None
    for tag in ("{http://arxiv.org/schemas/atom}doi",):
        text = entry.findtext(tag)
        if text:
            doi = find_doi(text)
    pdf = None
    for link in entry.findall("a:link", ns):
        href = link.attrib.get("href", "")
        if link.attrib.get("title") == "pdf" or "/pdf/" in href:
            pdf = href
            break
    if not title:
        return None
    return {
        "title": title,
        "abstract": summary or None,
        "year": year,
        "authors": authors,
        "doi": doi or find_doi(f"10.48550/arxiv.{arxiv_id}"),
        "arxiv_id": find_arxiv(arxiv_id, bare=True) or arxiv_id,
        "pdf_url": pdf,
    }
