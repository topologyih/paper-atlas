"""Turn an OpenAlex work into the public paper record and merge duplicates."""

from __future__ import annotations

import re

from .score import impact_per_year
from .textutil import (
    VENUE_RANK,
    authors_from_work,
    bare_doi,
    cap_refs,
    extract_arxiv,
    is_bad_title,
    pdf_urls,
    reconstruct_abstract,
    short_id,
    title_key,
    venue_from_work,
)

ALLOWED_TYPES = {
    "article",
    "preprint",
    "review",
    "book-chapter",
    "book",
    "report",
    "other",
    "conference-paper",
    "proceedings-article",
    "posted-content",
}


def ref_list(work: dict) -> list[str]:
    refs = []
    for value in work.get("referenced_works") or []:
        token = short_id(value)
        if token:
            refs.append(token)
    return refs


def record_from_work(work: dict, impact_year: int, *, force: bool = False, must_keep: set[str] | None = None) -> dict | None:
    if not isinstance(work, dict) or not work.get("id"):
        return None
    if work.get("is_retracted") and not force:
        return None
    work_type = (work.get("type") or "unknown").lower()
    if work_type not in ALLOWED_TYPES and not force:
        return None
    title = re.sub(r"\s+", " ", str(work.get("display_name") or "")).strip()
    title = re.sub(r"<[^>]+>", "", title).strip()
    if is_bad_title(title):
        return None
    year = work.get("publication_year")
    year = int(year) if isinstance(year, int) or (isinstance(year, str) and str(year).isdigit()) else None
    cited = work.get("cited_by_count")
    cited = int(cited) if isinstance(cited, (int, float)) else None
    doi = bare_doi(work.get("doi") or (work.get("ids") or {}).get("doi"))
    oa_url, pdf_url, landing = pdf_urls(work)
    arxiv_id = extract_arxiv(work, doi, oa_url, landing)
    venue, venue_short, venue_type = venue_from_work(work)
    authors, author_count, author_string = authors_from_work(work)
    topics = []
    topic_ids = []
    for topic in (work.get("topics") or [])[:8]:
        name = (topic or {}).get("display_name")
        topic_token = short_id((topic or {}).get("id"))
        if name and name not in topics:
            topics.append(str(name))
        if topic_token and topic_token not in topic_ids:
            topic_ids.append(topic_token)
    abstract = reconstruct_abstract(work.get("abstract_inverted_index"))
    if abstract and len(abstract) > 1500:
        abstract = abstract[:1499].rstrip() + "…"
    refs, truncated = cap_refs(ref_list(work), must_keep or set())
    related = []
    for value in work.get("related_works") or []:
        token = short_id(value)
        if token and token not in related:
            related.append(token)
    if not landing and doi:
        landing = f"https://doi.org/{doi}"
    return {
        "id": short_id(work.get("id")),
        "title": title,
        "title_key": title_key(title),
        "year": year,
        "publication_date": work.get("publication_date") or None,
        "authors": authors,
        "author_count": author_count,
        "author_string": author_string,
        "venue": venue,
        "venue_short": venue_short,
        "venue_type": venue_type,
        "cited_by_count": cited,
        "impact_score": cited,
        "impact_per_year": impact_per_year(cited, year, impact_year),
        "abstract": abstract,
        "doi": doi,
        "arxiv_id": arxiv_id,
        "oa_url": oa_url,
        "pdf_url": pdf_url,
        "landing_url": landing,
        "topics": topics,
        "topic_ids": topic_ids,
        "keywords": list(topics),
        "referenced_works": refs,
        "related_works": related[:30],
        "refs_truncated": truncated,
        "type": work_type,
        "origin_tags": [],
        "alternate_ids": [],
        "cites_seed": False,
        "cited_by_seed": False,
        "is_seed": False,
        "cocitation_count": 0,
        "topic_overlap": 0,
        "relations": [],
        "relation": "semantic",
        "relevance_score": 0,
        "relevance_parts": {},
    }


def titles_match(left: dict, right: dict) -> bool:
    key = left.get("title_key") or ""
    if len(key) < 12 or key != (right.get("title_key") or ""):
        return False
    year_left, year_right = left.get("year"), right.get("year")
    if year_left is None or year_right is None:
        return True
    return abs(int(year_left) - int(year_right)) <= 1


def _better_venue(candidate: dict, current: dict) -> bool:
    if candidate.get("venue") in (None, "", "Unknown"):
        return False
    if current.get("venue") in (None, "", "Unknown"):
        return True
    candidate_rank = VENUE_RANK.get(candidate.get("venue_type"), 4)
    current_rank = VENUE_RANK.get(current.get("venue_type"), 4)
    if candidate_rank >= current_rank:
        return False
    candidate_cites = candidate.get("cited_by_count") or 0
    current_cites = current.get("cited_by_count") or 0
    return current_cites == 0 or candidate_cites >= 0.5 * current_cites


def _unique(values) -> list:
    seen = set()
    result = []
    for value in values:
        if value in seen or value in (None, ""):
            continue
        seen.add(value)
        result.append(value)
    return result


def merge_records(left: dict, right: dict, must_keep: set[str], impact_year: int) -> dict:
    left_cites = left.get("cited_by_count") if left.get("cited_by_count") is not None else -1
    right_cites = right.get("cited_by_count") if right.get("cited_by_count") is not None else -1
    primary, secondary = (left, right) if left_cites >= right_cites else (right, left)
    merged = dict(primary)
    counts = [value for value in (left.get("cited_by_count"), right.get("cited_by_count")) if value is not None]
    merged["cited_by_count"] = max(counts) if counts else None
    merged["impact_score"] = merged["cited_by_count"]
    merged["impact_per_year"] = impact_per_year(merged["cited_by_count"], merged.get("year"), impact_year)
    for field in ("abstract", "doi", "arxiv_id", "oa_url", "pdf_url", "landing_url", "publication_date"):
        if not merged.get(field) and secondary.get(field):
            merged[field] = secondary[field]
    if len(secondary.get("authors") or []) > len(merged.get("authors") or []):
        merged["authors"] = secondary["authors"]
        merged["author_count"] = max(merged.get("author_count") or 0, secondary.get("author_count") or 0)
        merged["author_string"] = secondary["author_string"]
    if _better_venue(secondary, merged):
        merged["venue"] = secondary["venue"]
        merged["venue_short"] = secondary["venue_short"]
        merged["venue_type"] = secondary["venue_type"]
        if secondary.get("year") is not None:
            merged["year"] = secondary["year"]
            merged["impact_per_year"] = impact_per_year(merged["cited_by_count"], merged["year"], impact_year)
        if secondary.get("doi") and (not merged.get("doi") or "arxiv" in merged.get("doi", "")):
            merged["doi"] = secondary["doi"]
    merged["topics"] = _unique([*(merged.get("topics") or []), *(secondary.get("topics") or [])])[:8]
    merged["topic_ids"] = _unique([*(merged.get("topic_ids") or []), *(secondary.get("topic_ids") or [])])[:8]
    merged["keywords"] = list(merged["topics"])
    combined_refs = _unique([*(left.get("referenced_works") or []), *(right.get("referenced_works") or [])])
    capped, truncated = cap_refs(combined_refs, must_keep)
    merged["referenced_works"] = capped
    merged["refs_truncated"] = truncated
    merged["related_works"] = _unique([*(left.get("related_works") or []), *(right.get("related_works") or [])])[:30]
    merged["origin_tags"] = sorted(set(left.get("origin_tags") or []) | set(right.get("origin_tags") or []))
    merged["alternate_ids"] = [
        token
        for token in _unique(
            [
                *(left.get("alternate_ids") or []),
                *(right.get("alternate_ids") or []),
                left.get("id"),
                right.get("id"),
            ]
        )
        if token and token != merged.get("id")
    ]
    merged["cocitation_count"] = max(int(left.get("cocitation_count") or 0), int(right.get("cocitation_count") or 0))
    return merged


def dedup_records(records: list[dict], must_keep: set[str], impact_year: int) -> list[dict]:
    clusters: list[dict] = []
    for record in records:
        match_at = None
        for index, existing in enumerate(clusters):
            same_id = record["id"] == existing["id"] or record["id"] in (existing.get("alternate_ids") or [])
            same_doi = record.get("doi") and record.get("doi") == existing.get("doi")
            if same_id or same_doi or titles_match(record, existing):
                match_at = index
                break
        if match_at is None:
            clusters.append(record)
        else:
            clusters[match_at] = merge_records(clusters[match_at], record, must_keep, impact_year)
    return clusters
