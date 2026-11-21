"""Text, venue, and identifier helpers shared by fetch, score, and dedup."""

from __future__ import annotations

import html
import re

STOPWORDS = {
    "a", "an", "the", "of", "and", "or", "for", "to", "in", "on", "with", "by",
    "from", "at", "as", "is", "are", "was", "were", "be", "been", "being",
    "that", "this", "these", "those", "it", "its", "into", "over", "under",
    "than", "then", "via", "using", "use", "used", "based", "between", "among",
    "through", "we", "our", "their", "they", "can", "may", "also", "not", "no",
    "yes", "such", "which", "who", "whom", "what", "when", "where", "how",
    "all", "any", "each", "both", "few", "more", "most", "other", "some",
    "only", "own", "same", "so", "too", "very", "just", "about", "after",
    "before", "above", "below", "up", "down", "out", "off", "again", "further",
    "once", "here", "there", "why", "if", "while", "during", "within",
    "without", "across", "per", "vs", "versus", "et", "al", "study", "paper",
    "results", "method", "methods", "approach", "however", "new",
}

TOKEN_RE = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]+", re.IGNORECASE)
TAG_RE = re.compile(r"<[^>]+>")
BAD_TITLE_RE = re.compile(
    r"^(front matter|back matter|editorial board|table of contents|title page|contents|index)$",
    re.IGNORECASE,
)
VENUE_RANK = {
    "conference": 0,
    "journal": 0,
    "book series": 1,
    "ebook platform": 2,
    "repository": 3,
    "unknown": 4,
}


def short_id(value: str | None) -> str | None:
    if not value:
        return None
    token = str(value).rstrip("/").split("/")[-1].strip()
    return token or None


def bare_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = str(value).strip()
    doi = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", doi, flags=re.IGNORECASE)
    doi = re.sub(r"^doi:\s*", "", doi, flags=re.IGNORECASE)
    doi = re.sub(r"[.,;:)>\]]+$", "", doi).lower()
    return doi or None


def reconstruct_abstract(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if not isinstance(value, dict):
        return None
    pairs: list[tuple[int, str]] = []
    for word, locs in value.items():
        if not isinstance(locs, list):
            continue
        for loc in locs:
            if isinstance(loc, int):
                pairs.append((loc, str(word)))
    if not pairs:
        return None
    pairs.sort(key=lambda item: item[0])
    text = " ".join(word for _, word in pairs).strip()
    return text or None


def title_key(title: str | None) -> str:
    text = (title or "").lower()
    text = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokenize(title: str | None, abstract: str | None) -> dict[str, int]:
    """Bag of words. The title is counted twice; CJK text becomes bigrams."""
    source = f"{title or ''} {title or ''} {(abstract or '')[:500]}"
    counts: dict[str, int] = {}
    for match in TOKEN_RE.finditer(source.lower()):
        token = match.group(0)
        if "\u4e00" <= token[0] <= "\u9fff":
            grams = [token] if len(token) == 1 else [token[i : i + 2] for i in range(len(token) - 1)]
        else:
            grams = [token]
        for gram in grams:
            if gram in STOPWORDS or len(gram) < 2:
                continue
            counts[gram] = counts.get(gram, 0) + 1
    return counts


def cosine(left: dict[str, int], right: dict[str, int]) -> float:
    if not left or not right:
        return 0.0
    dot = 0.0
    for key, value in left.items():
        other = right.get(key)
        if other:
            dot += value * other
    if dot <= 0:
        return 0.0
    norm_left = sum(value * value for value in left.values()) ** 0.5
    norm_right = sum(value * value for value in right.values()) ** 0.5
    if norm_left == 0 or norm_right == 0:
        return 0.0
    return dot / (norm_left * norm_right)


def jaccard(left, right) -> float:
    a = set(left or [])
    b = set(right or [])
    if not a and not b:
        return 0.0
    union = len(a | b)
    if union == 0:
        return 0.0
    return len(a & b) / union


def clean_venue(name: str | None) -> str:
    if not name or not str(name).strip():
        return "Unknown"
    text = html.unescape(TAG_RE.sub("", str(name)))
    text = re.sub(r"\s+", " ", text).strip()
    if "arxiv" in text.lower():
        return "arXiv"
    if text.count("/") >= 1 and len(text) > 80:
        parts = [part.strip() for part in re.split(r"\s*/\s*", text) if part.strip()]
        if parts:
            text = sorted(parts, key=len)[0]
    text = text.split(" - ")[0].strip()
    text = re.sub(r"(?i)^proceedings of (the )?", "", text).strip()
    text = re.sub(r"\s+", " ", text).strip(" ,.-/")
    return text or "Unknown"


def short_venue(name: str | None) -> str:
    if not name or name == "Unknown":
        return "Unknown"
    if name == "arXiv":
        return "arXiv"
    match = re.search(r"\(([A-Z][A-Za-z0-9.&/+-]{2,18})\)\s*$", name)
    if match:
        return match.group(1)
    if len(name) > 36:
        return name[:34].rstrip() + "…"
    return name


def _location_name(location: dict) -> tuple[str, str]:
    source = location.get("source") or {}
    raw = source.get("display_name") or location.get("raw_source_name") or ""
    venue_type = (source.get("type") or "unknown").lower()
    return clean_venue(raw), venue_type


def venue_from_work(work: dict) -> tuple[str, str, str]:
    candidates = []
    primary = work.get("primary_location")
    if primary:
        candidates.append(primary)
    candidates.extend(work.get("locations") or [])
    best = None
    best_key = None
    for location in candidates:
        if not isinstance(location, dict):
            continue
        cleaned, venue_type = _location_name(location)
        rank = VENUE_RANK.get(venue_type, 4)
        if cleaned == "arXiv":
            rank = max(rank, 3)
            venue_type = "repository"
        published_penalty = 0 if location.get("is_published") else 1
        key = (rank, published_penalty, 0 if cleaned != "Unknown" else 1)
        if best is None or key < best_key:
            best = (cleaned, short_venue(cleaned), venue_type)
            best_key = key
    if not best:
        return "Unknown", "Unknown", "unknown"
    return best


def authors_from_work(work: dict, limit: int = 20) -> tuple[list[str], int, str]:
    names: list[str] = []
    for authorship in work.get("authorships") or []:
        author = authorship.get("author") or {}
        name = author.get("display_name") or authorship.get("raw_author_name")
        if not name:
            continue
        cleaned = re.sub(r"\s+", " ", str(name)).strip()
        if cleaned and cleaned not in names:
            names.append(cleaned)
    total = len(work.get("authorships") or []) or len(names)
    if not names:
        return [], total, "Unknown"
    shown = names[:limit]
    text = ", ".join(shown)
    if total > len(shown):
        text += " et al."
    return shown, total, text


def extract_arxiv(work: dict, doi: str | None, oa_url: str | None, landing: str | None) -> str | None:
    ids = work.get("ids") or {}
    raw = ids.get("arxiv")
    if raw:
        token = str(raw).rstrip("/").split("/")[-1]
        return re.sub(r"v\d+$", "", token, flags=re.IGNORECASE)
    blob = " ".join(part for part in (doi, oa_url, landing) if part)
    match = re.search(
        r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})",
        blob,
        re.IGNORECASE,
    )
    if match:
        return match.group(1)
    match = re.search(r"10\.48550/arxiv\.(\d{4}\.\d{4,5})", blob, re.IGNORECASE)
    if match:
        return match.group(1)
    return None


def pdf_urls(work: dict) -> tuple[str | None, str | None, str | None]:
    primary = work.get("primary_location") or {}
    locations = [primary, *(work.get("locations") or [])]
    pdf = None
    landing = primary.get("landing_page_url")
    oa_url = (work.get("open_access") or {}).get("oa_url")
    for location in locations:
        if not isinstance(location, dict):
            continue
        if not landing and location.get("landing_page_url"):
            landing = location.get("landing_page_url")
        candidate = location.get("pdf_url")
        if candidate and not pdf:
            pdf = candidate
    if oa_url and not pdf and ("/pdf" in oa_url.lower() or oa_url.lower().endswith(".pdf")):
        pdf = oa_url
    return oa_url, pdf, landing


def cap_refs(refs: list[str], must_keep: set[str], limit: int = 200) -> tuple[list[str], bool]:
    unique: list[str] = []
    seen = set()
    for ref in refs:
        if ref and ref not in seen:
            seen.add(ref)
            unique.append(ref)
    if len(unique) <= limit:
        return unique, False
    head = [ref for ref in unique if ref in must_keep]
    tail = [ref for ref in unique if ref not in must_keep]
    return (head + tail)[:limit], True


def is_bad_title(title: str | None) -> bool:
    if not title or not str(title).strip():
        return True
    return bool(BAD_TITLE_RE.fullmatch(str(title).strip()))
