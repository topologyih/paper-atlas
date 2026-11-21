"""Relevance, impact, relations, and sparse edges.

Keep the weights in sync with src/lib/score.js and tests/fixtures/weights.json.
"""

from __future__ import annotations

from .textutil import cosine, jaccard, tokenize

RELEVANCE_WEIGHTS = {
    "direct": 0.30,
    "coupling": 0.26,
    "cocitation": 0.16,
    "topic": 0.14,
    "text": 0.10,
    "related": 0.04,
}

RELATION_PRIORITY = (
    "seed",
    "both",
    "reference",
    "citing",
    "related",
    "cocitation",
    "topic",
    "semantic",
)


def impact_per_year(cited_by_count, year, impact_year: int):
    if cited_by_count is None or year is None:
        return None
    return round(float(cited_by_count) / max(1, int(impact_year) - int(year)), 2)


def relation_labels(record: dict, seed_related: set[str]) -> list[str]:
    if record.get("is_seed"):
        return ["seed"]
    labels = []
    cites = bool(record.get("cites_seed"))
    cited = bool(record.get("cited_by_seed"))
    if cites and cited:
        labels.append("both")
    elif cited:
        labels.append("reference")
    elif cites:
        labels.append("citing")
    if record.get("id") in seed_related or "related" in (record.get("origin_tags") or []):
        labels.append("related")
    if int(record.get("cocitation_count") or 0) >= 3:
        labels.append("cocitation")
    if record.get("topic_overlap"):
        labels.append("topic")
    if not labels:
        labels.append("semantic")
    order = {name: index for index, name in enumerate(RELATION_PRIORITY)}
    return sorted(set(labels), key=lambda name: order.get(name, 99))


def score_relevance(
    paper: dict,
    center: dict,
    *,
    coco_score: float,
    coco_available: bool,
    paper_tokens: dict | None = None,
    center_tokens: dict | None = None,
) -> dict:
    """Score `paper` against `center`. Components are each in [0, 1]."""
    if paper.get("id") == center.get("id"):
        return {
            "score": 1.0,
            "parts": {
                "direct": 1.0,
                "coupling": 1.0,
                "cocitation": 1.0,
                "topic": 1.0,
                "text": 1.0,
                "related": 1.0,
            },
            "weights": dict(RELEVANCE_WEIGHTS),
        }

    center_refs = set(center.get("referenced_works") or [])
    paper_refs = set(paper.get("referenced_works") or [])
    direct = 1.0 if (paper["id"] in center_refs or center["id"] in paper_refs) else 0.0
    coupling = jaccard(center_refs, paper_refs)
    center_topics = [topic for topic in (center.get("topic_ids") or []) if topic]
    paper_topics = set(paper.get("topic_ids") or [])
    topic = 0.0
    if center_topics:
        topic = len([topic_id for topic_id in center_topics if topic_id in paper_topics]) / len(center_topics)
    left = paper_tokens if paper_tokens is not None else tokenize(paper.get("title"), paper.get("abstract"))
    right = center_tokens if center_tokens is not None else tokenize(center.get("title"), center.get("abstract"))
    text = cosine(left, right)
    related = 1.0 if paper.get("id") in set(center.get("related_works") or []) else 0.0
    coco = max(0.0, min(1.0, float(coco_score or 0)))
    parts = {
        "direct": direct,
        "coupling": coupling,
        "cocitation": coco if coco_available else 0.0,
        "topic": topic,
        "text": text,
        "related": related,
    }
    weights = dict(RELEVANCE_WEIGHTS)
    if not coco_available:
        weights["cocitation"] = 0.0
        total = sum(weights.values()) or 1.0
        weights = {key: value / total for key, value in weights.items()}
    score = sum(weights[key] * parts[key] for key in weights)
    score = max(0.0, min(1.0, score))
    return {
        "score": round(score, 4),
        "parts": {key: round(value, 4) for key, value in parts.items()},
        "weights": {key: round(value, 4) for key, value in weights.items()},
    }


def build_edges(papers: list[dict], seed_id: str, *, k: int = 2, max_edges: int = 900) -> list[dict]:
    """Solid edges are citations. Dashed edges are bibliographic or lexical neighbors."""
    by_id = {paper["id"]: paper for paper in papers}
    refsets = {paper["id"]: set(paper.get("referenced_works") or []) for paper in papers}
    tokens = {
        paper["id"]: tokenize(paper.get("title"), paper.get("abstract"))
        for paper in papers
    }
    edges: dict[tuple, dict] = {}

    def add(source: str, target: str, kind: str, weight: float) -> None:
        if source == target:
            return
        if kind == "similarity":
            citation_key = tuple(sorted((source, target))) + ("citation",)
            if citation_key in edges:
                return
        key = tuple(sorted((source, target))) + (kind,)
        weight = round(float(weight), 4)
        current = edges.get(key)
        if current:
            current["weight"] = max(current["weight"], weight)
            return
        left, right = sorted((source, target))
        edges[key] = {"source": left, "target": right, "type": kind, "weight": weight}

    ids = list(by_id)
    for index, left in enumerate(ids):
        left_refs = refsets[left]
        for right in ids[index + 1 :]:
            if right in left_refs or left in refsets[right]:
                add(left, right, "citation", 1.0)

    for left in ids:
        ranked = []
        for right in ids:
            if left == right:
                continue
            coupling = jaccard(refsets[left], refsets[right])
            text = cosine(tokens[left], tokens[right])
            if coupling < 0.03 and text < 0.5:
                continue
            ranked.append((0.7 * coupling + 0.3 * text, right))
        ranked.sort(key=lambda item: item[0], reverse=True)
        limit = k + 1 if left == seed_id else k
        for weight, right in ranked[:limit]:
            add(left, right, "similarity", weight)

    listed = list(edges.values())
    if len(listed) <= max_edges:
        return listed

    def rank(edge: dict):
        incident = edge["source"] == seed_id or edge["target"] == seed_id
        return (incident, edge["type"] == "citation", edge["weight"])

    listed.sort(key=rank, reverse=True)
    return listed[:max_edges]
