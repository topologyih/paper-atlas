"""Resolve one seed paper and expand a real, deduplicated neighborhood."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from .client import SELECT, OpenAlexClient, OpenAlexError
from .external import (
    arxiv_entry,
    crossref_search,
    identifiers_from_page,
    semantic_scholar_paper,
    semantic_scholar_search,
)
from .normalize import dedup_records, record_from_work
from .parse import parse_query
from .score import build_edges, relation_labels, score_relevance
from .textutil import short_id, title_key, tokenize

LIMITATIONS = [
    "引用数、参考文献和主题来自 OpenAlex，不等于 Google Scholar 的引用数。OpenAlex 说明其参考文献匹配并不完整。",
    "相关度不是神经网络向量，而是直接引用、参考文献 Jaccard、共引比例、主题重叠和标题/摘要词袋余弦的加权和。",
    "共引比例的分母是本次抓取到的施引论文，不是种子的全部施引文献，因此偏向被高被引后续论文一起引用的文献。",
    "同一期刊的颜色只保证本次语料里引用量最高的来源各自一色；更少见的来源归入“其他”。",
    "预印本经常只有 arXiv 作为主来源。若 OpenAlex 另有期刊或会议版本，且引用数不低于一半，则采用那个来源名称。",
    "每篇论文最多保留 200 条已匹配参考文献。图中的相似边做了稀疏化：直接引用用实线，每篇论文再保留少量共引或文本近邻的虚线。",
    "缺失的标题、作者、年份、期刊、DOI 或摘要不会被补写，界面显示 Unknown。",
]


class AmbiguousQuery(Exception):
    def __init__(self, candidates: list[dict]):
        super().__init__("找到多篇可能的论文，需要选择种子")
        self.candidates = candidates


def expansion_plan(limit: int) -> dict:
    if limit <= 50:
        return {"citer_pages": 1, "per_page": 40, "ref_cap": 40, "coco_cap": 20, "topic": 20}
    if limit <= 100:
        return {"citer_pages": 2, "per_page": 50, "ref_cap": 70, "coco_cap": 30, "topic": 30}
    if limit <= 180:
        return {"citer_pages": 2, "per_page": 50, "ref_cap": 90, "coco_cap": 40, "topic": 40}
    if limit <= 300:
        return {"citer_pages": 3, "per_page": 80, "ref_cap": 100, "coco_cap": 50, "topic": 40}
    return {"citer_pages": 4, "per_page": 100, "ref_cap": 120, "coco_cap": 60, "topic": 50}


def _best(works: list[dict]) -> dict | None:
    if not works:
        return None
    return max(works, key=lambda work: work.get("cited_by_count") or 0)


def fetch_by_doi(client: OpenAlexClient, doi: str) -> dict | None:
    payload = client.get("/works", {"filter": f"doi:{doi}", "per-page": "5", "select": SELECT})
    return _best(payload.get("results") or [])


def fetch_by_arxiv(client: OpenAlexClient, arxiv_id: str) -> dict | None:
    payload = client.get(
        "/works",
        {"filter": f"ids.arxiv:{arxiv_id}", "per-page": "5", "select": SELECT},
    )
    return _best(payload.get("results") or [])


def fetch_by_openalex(client: OpenAlexClient, openalex_id: str) -> dict | None:
    try:
        payload = client.get(f"/works/{openalex_id}", {"select": SELECT})
    except OpenAlexError as error:
        if error.status == 404:
            return None
        raise
    if payload.get("id"):
        return payload
    return _best(payload.get("results") or [])


def fetch_batch(client: OpenAlexClient, ids: list[str]) -> list[dict]:
    unique = []
    seen = set()
    for value in ids:
        token = short_id(value)
        if token and token not in seen:
            seen.add(token)
            unique.append(token)
    works = []
    for start in range(0, len(unique), 50):
        chunk = unique[start : start + 50]
        payload = client.get(
            "/works",
            {
                "filter": "openalex:" + "|".join(chunk),
                "per-page": str(len(chunk)),
                "select": SELECT,
            },
        )
        works.extend(payload.get("results") or [])
    return works


def fetch_citers(client: OpenAlexClient, seed_id: str, plan: dict, warnings: list[str]) -> list[dict]:
    works = []
    for page in range(1, plan["citer_pages"] + 1):
        try:
            payload = client.get(
                "/works",
                {
                    "filter": f"cites:{seed_id}",
                    "sort": "cited_by_count:desc",
                    "per-page": str(plan["per_page"]),
                    "page": str(page),
                    "select": SELECT,
                },
            )
        except OpenAlexError as error:
            warnings.append(f"施引文献第 {page} 页没有取回：{error}")
            break
        rows = payload.get("results") or []
        works.extend(rows)
        if len(rows) < plan["per_page"]:
            break
    return works


def fetch_topic_works(client: OpenAlexClient, topic_id: str, year: int | None, limit: int, warnings: list[str]) -> list[dict]:
    if not topic_id or limit <= 0:
        return []
    start = max(1990, (year or 2017) - 3)
    end = (year or 2017) + 8
    filters = [
        f"topics.id:{topic_id},publication_year:{start}-{end},cited_by_count:>40",
        f"topics.id:{topic_id},cited_by_count:>100",
    ]
    for expression in filters:
        try:
            payload = client.get(
                "/works",
                {
                    "filter": expression,
                    "sort": "cited_by_count:desc",
                    "per-page": str(limit),
                    "select": SELECT,
                },
            )
            return payload.get("results") or []
        except OpenAlexError as error:
            warnings.append(f"主题扩展失败，已跳过这一路：{error}")
    return []


def _candidate(work: dict) -> dict:
    venue, venue_short, _venue_type = ("Unknown", "Unknown", "unknown")
    try:
        from .textutil import venue_from_work

        venue, venue_short, _venue_type = venue_from_work(work)
    except Exception:
        venue_short = "Unknown"
    authors = []
    for authorship in (work.get("authorships") or [])[:6]:
        name = ((authorship.get("author") or {}).get("display_name")) or authorship.get("raw_author_name")
        if name:
            authors.append(name)
    return {
        "id": short_id(work.get("id")),
        "title": work.get("display_name") or "Unknown",
        "year": work.get("publication_year"),
        "cited_by_count": work.get("cited_by_count"),
        "doi": work.get("doi"),
        "venue": venue_short or venue,
        "authors": authors,
    }


def match_title(query: str, results: list[dict]):
    key = title_key(query)
    exact = [work for work in results if title_key(work.get("display_name")) == key and len(key) >= 12]
    if exact:
        return "one", _best(exact)
    query_tokens = set(tokenize(query, None))
    scored = []
    for work in results:
        tokens = set(tokenize(work.get("display_name"), None))
        overlap = len(query_tokens & tokens) / len(query_tokens) if query_tokens else 0
        scored.append((overlap, work.get("cited_by_count") or 0, work))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    if not scored or scored[0][0] < 0.45:
        return "none", None
    close = [item for item in scored if item[0] >= max(0.45, scored[0][0] - 0.08)]
    if len(close) == 1 or (len(close) > 1 and close[0][0] >= close[1][0] + 0.2 and close[0][0] >= 0.6):
        return "one", close[0][2]
    if close[0][0] >= 0.85 and (len(close) == 1 or close[0][0] > close[1][0]):
        return "one", close[0][2]
    return "many", [item[2] for item in close[:5]]


def resolve_title(client: OpenAlexClient, title: str, warnings: list[str], sources: list[str]) -> dict | None:
    search_failed = False
    try:
        payload = client.get("/works", {"search": title, "per-page": "8", "select": SELECT})
        results = payload.get("results") or []
    except OpenAlexError as error:
        search_failed = True
        results = []
        warnings.append(f"{error}。标题将改用 Crossref 和 Semantic Scholar 定位 DOI。")
    if results:
        status, chosen = match_title(title, results)
        if status == "one":
            return chosen
        if status == "many":
            raise AmbiguousQuery([_candidate(work) for work in chosen])
    for item in crossref_search(title):
        doi = (item.get("DOI") or "").lower()
        if not doi:
            continue
        work = fetch_by_doi(client, doi)
        if work:
            if "Crossref" not in sources:
                sources.append("Crossref")
            warnings.append(f"标题通过 Crossref DOI {doi} 定位到 OpenAlex。")
            return work
    for item in semantic_scholar_search(title):
        external = item.get("externalIds") or {}
        doi = (external.get("DOI") or "").lower()
        arxiv_id = external.get("ArXiv")
        work = fetch_by_doi(client, doi) if doi else None
        if not work and arxiv_id:
            work = fetch_by_arxiv(client, arxiv_id)
        if work:
            if "Semantic Scholar" not in sources:
                sources.append("Semantic Scholar")
            warnings.append("标题通过 Semantic Scholar 定位到 OpenAlex。")
            return work
    if search_failed:
        return None
    return None


def resolve_seed(client: OpenAlexClient, query: str, warnings: list[str], sources: list[str]) -> tuple[dict, dict]:
    parsed = parse_query(query)
    if parsed["kind"] == "invalid":
        raise OpenAlexError("请输入 DOI、arXiv、标题或论文 URL")
    work = None
    if parsed["kind"] == "doi":
        work = fetch_by_doi(client, parsed["value"])
    elif parsed["kind"] == "arxiv":
        work = fetch_by_arxiv(client, parsed["value"])
        if not work:
            entry = arxiv_entry(parsed["value"])
            if entry and entry.get("doi"):
                work = fetch_by_doi(client, entry["doi"])
            if not work and entry and entry.get("title"):
                if "arXiv" not in sources:
                    sources.append("arXiv")
                work = resolve_title(client, entry["title"], warnings, sources)
    elif parsed["kind"] == "openalex":
        work = fetch_by_openalex(client, parsed["value"])
    elif parsed["kind"] == "s2":
        paper = semantic_scholar_paper(parsed["value"])
        if paper:
            if "Semantic Scholar" not in sources:
                sources.append("Semantic Scholar")
            external = paper.get("externalIds") or {}
            if external.get("DOI"):
                work = fetch_by_doi(client, external["DOI"].lower())
            if not work and external.get("ArXiv"):
                work = fetch_by_arxiv(client, external["ArXiv"])
            if not work and paper.get("title"):
                work = resolve_title(client, paper["title"], warnings, sources)
    elif parsed["kind"] == "url":
        found = identifiers_from_page(parsed["value"])
        if found.get("doi"):
            work = fetch_by_doi(client, found["doi"])
        if not work and found.get("arxiv"):
            work = fetch_by_arxiv(client, found["arxiv"])
        if not work and found.get("title"):
            work = resolve_title(client, found["title"], warnings, sources)
        if not work and found.get("error"):
            warnings.append("浏览器或服务器没能读取这个 URL。请改用 DOI 或 arXiv。")
    elif parsed["kind"] == "title":
        work = resolve_title(client, parsed["value"], warnings, sources)
    if not work:
        raise OpenAlexError("没有在 OpenAlex 中定位到这篇论文。可以换 DOI，或稍后重试。")
    return work, parsed


def _collect(works, label, impact_year, must_keep, *, force=False):
    records = []
    skipped = 0
    for work in works:
        record = record_from_work(work, impact_year, force=force, must_keep=must_keep)
        if record is None:
            skipped += 1
            continue
        record["origin_tags"] = [label]
        records.append(record)
    return records, skipped


def select_final(records: list[dict], seed_id: str, limit: int) -> list[dict]:
    seed = next(record for record in records if record["id"] == seed_id)
    others = [record for record in records if record["id"] != seed_id]
    if len(records) <= limit:
        others.sort(key=lambda record: (-(record.get("relevance_score") or 0), -(record.get("cited_by_count") or 0)))
        return [seed, *others]
    budget = max(1, limit - 1)
    references = sorted(
        (record for record in others if record.get("cited_by_seed")),
        key=lambda record: -(record.get("cited_by_count") or 0),
    )
    citers = sorted(
        (record for record in others if record.get("cites_seed") and not record.get("cited_by_seed")),
        key=lambda record: -(record.get("cited_by_count") or 0),
    )
    related = [
        record
        for record in others
        if "related" in (record.get("origin_tags") or []) and not record.get("cites_seed") and not record.get("cited_by_seed")
    ]
    ref_slots = min(len(references), max(8, round(budget * 0.28)))
    cite_slots = min(len(citers), max(8, round(budget * 0.34)))
    related_slots = min(len(related), round(budget * 0.08))
    if ref_slots + cite_slots + related_slots > budget:
        related_slots = min(related_slots, budget // 10)
        remaining = budget - related_slots
        ref_slots = min(ref_slots, remaining // 2)
        cite_slots = min(cite_slots, remaining - ref_slots)
    chosen = []
    chosen_ids = set()

    def take(items, count):
        got = 0
        for item in items:
            if item["id"] in chosen_ids:
                continue
            chosen.append(item)
            chosen_ids.add(item["id"])
            got += 1
            if got >= count:
                break

    take(references, ref_slots)
    take(citers, cite_slots)
    take(related, related_slots)
    rest = sorted(
        (record for record in others if record["id"] not in chosen_ids),
        key=lambda record: (-(record.get("relevance_score") or 0), -(record.get("cited_by_count") or 0)),
    )
    take(rest, max(0, budget - len(chosen)))
    return [seed, *chosen]


def _missing_ratio(papers: list[dict], predicate) -> float:
    if not papers:
        return 0.0
    return round(sum(1 for paper in papers if predicate(paper)) / len(papers), 4)


def build_graph(
    query: str,
    *,
    limit: int = 100,
    client: OpenAlexClient,
    impact_year: int | None = None,
    progress=None,
    origin: str = "live",
) -> dict:
    progress = progress or (lambda _message: None)
    impact_year = impact_year or datetime.now(timezone.utc).year
    limit = max(10, min(int(limit), 500))
    plan = expansion_plan(limit)
    warnings: list[str] = []
    sources = ["OpenAlex"]
    progress("识别输入并获取种子论文")
    seed_work, parsed = resolve_seed(client, query, warnings, sources)
    seed_short = short_id(seed_work.get("id"))
    if not seed_short:
        raise OpenAlexError("OpenAlex 返回的种子论文没有 ID")
    must_keep = {seed_short}
    progress("扩展施引文献")
    citers = fetch_citers(client, seed_short, plan, warnings)
    progress("获取参考文献与 OpenAlex 相关论文")
    ref_ids = []
    for value in seed_work.get("referenced_works") or []:
        token = short_id(value)
        if token and token not in ref_ids:
            ref_ids.append(token)
        if len(ref_ids) >= plan["ref_cap"]:
            break
    related_ids = []
    for value in seed_work.get("related_works") or []:
        token = short_id(value)
        if token and token not in related_ids:
            related_ids.append(token)
    references = fetch_batch(client, ref_ids) if ref_ids else []
    related = fetch_batch(client, related_ids) if related_ids else []
    progress("按主题补充论文")
    topics = seed_work.get("topics") or []
    topic_id = short_id(topics[0].get("id")) if topics else None
    topic_works = fetch_topic_works(
        client,
        topic_id,
        seed_work.get("publication_year"),
        plan["topic"],
        warnings,
    )
    progress("统计共引并补齐论文")
    counts: Counter[str] = Counter()
    denominator = 0
    for work in citers:
        refs = []
        seen = set()
        for value in work.get("referenced_works") or []:
            token = short_id(value)
            if token and token not in seen:
                seen.add(token)
                refs.append(token)
        if not refs:
            continue
        denominator += 1
        for token in refs:
            if token != seed_short:
                counts[token] += 1
    already = {seed_short}
    for work in citers + references + related + topic_works:
        token = short_id(work.get("id"))
        if token:
            already.add(token)
    extra_ids = [token for token, count in counts.most_common(120) if token not in already and count >= 2]
    extra_ids = extra_ids[: plan["coco_cap"]]
    extra = fetch_batch(client, extra_ids) if extra_ids else []
    progress("清洗、去重并计算相关度")
    return assemble_graph(
        query=query,
        parsed=parsed,
        seed_work=seed_work,
        seed_short=seed_short,
        citers=citers,
        references=references,
        related=related,
        topic_works=topic_works,
        extra=extra,
        counts=counts,
        denominator=denominator,
        impact_year=impact_year,
        limit=limit,
        origin=origin,
        sources=sources,
        warnings=warnings,
        api_calls=client.api_calls,
        cache_hits=client.cache_hits,
        budget_remaining=client.last_headers.get("x-ratelimit-remaining-usd"),
        must_keep=must_keep,
    )


def assemble_graph(
    *,
    query,
    parsed,
    seed_work,
    seed_short,
    citers,
    references,
    related,
    topic_works,
    extra,
    counts,
    denominator,
    impact_year,
    limit,
    origin,
    sources,
    warnings,
    api_calls,
    cache_hits,
    budget_remaining,
    must_keep,
):
    groups = [
        _collect([seed_work], "seed", impact_year, must_keep, force=True),
        _collect(citers, "citing", impact_year, must_keep),
        _collect(references, "reference", impact_year, must_keep),
        _collect(related, "related", impact_year, must_keep),
        _collect(topic_works, "topic", impact_year, must_keep),
        _collect(extra, "cocitation", impact_year, must_keep),
    ]
    records = []
    skipped = 0
    for group, group_skipped in groups:
        records.extend(group)
        skipped += group_skipped
    fetched_records = len(records)
    records = dedup_records(records, must_keep, impact_year)
    deduped = fetched_records - len(records)
    seed = None
    for record in records:
        identity = {record["id"], *(record.get("alternate_ids") or [])}
        if seed_short in identity or "seed" in (record.get("origin_tags") or []):
            seed = record
            break
    if seed is None:
        raise OpenAlexError("种子论文在去重后丢失")
    seed["is_seed"] = True
    seed_ids = {seed["id"], seed_short, *(seed.get("alternate_ids") or [])}
    seed_refs = set(seed.get("referenced_works") or [])
    seed_topics = set(seed.get("topic_ids") or [])
    seed_related = set(seed.get("related_works") or [])
    for record in records:
        identity = {record["id"], *(record.get("alternate_ids") or [])}
        record["cocitation_count"] = sum(counts.get(token, 0) for token in identity)
        record["is_seed"] = record["id"] == seed["id"]
        record["cited_by_seed"] = bool(identity & seed_refs) or "reference" in (record.get("origin_tags") or [])
        record["cites_seed"] = bool(set(record.get("referenced_works") or []) & seed_ids) or (
            "citing" in (record.get("origin_tags") or []) and not record["is_seed"]
        )
        if record["is_seed"]:
            record["cited_by_seed"] = False
            record["cites_seed"] = False
        record["topic_overlap"] = len(seed_topics & set(record.get("topic_ids") or []))
    coco_available = denominator >= 5
    max_count = max((record["cocitation_count"] for record in records), default=0)
    center_tokens = tokenize(seed.get("title"), seed.get("abstract"))
    for record in records:
        paper_tokens = tokenize(record.get("title"), record.get("abstract"))
        coco = (record["cocitation_count"] / denominator) if denominator else 0.0
        scored = score_relevance(
            record,
            seed,
            coco_score=coco,
            coco_available=coco_available,
            paper_tokens=paper_tokens,
            center_tokens=center_tokens,
        )
        record["relevance_score"] = scored["score"]
        record["relevance_parts"] = scored["parts"]
        record["relations"] = relation_labels(record, seed_related)
        record["relation"] = record["relations"][0]
    final = select_final(records, seed["id"], limit)
    edges = build_edges(final, seed["id"])
    if len(final) < limit:
        warnings.append(f"清洗后得到 {len(final)} 篇，少于请求的 {limit} 篇。没有用虚构论文补齐。")
    if any(paper.get("refs_truncated") for paper in final):
        warnings.append("部分论文的参考文献超过 200 条，Jaccard 使用截断后的列表。")
    if not coco_available:
        warnings.append("可用的施引参考文献太少，相关度没有使用共引项，其余权重已重新归一。")
    relation_counts = {}
    for paper in final:
        relation_counts[paper["relation"]] = relation_counts.get(paper["relation"], 0) + 1
    for paper in final:
        paper.pop("title_key", None)
    missing = {
        "authors": _missing_ratio(final, lambda paper: not paper.get("authors")),
        "year": _missing_ratio(final, lambda paper: paper.get("year") is None),
        "venue": _missing_ratio(final, lambda paper: paper.get("venue") in (None, "", "Unknown")),
        "cited_by_count": _missing_ratio(final, lambda paper: paper.get("cited_by_count") is None),
        "abstract": _missing_ratio(final, lambda paper: not paper.get("abstract")),
        "doi": _missing_ratio(final, lambda paper: not paper.get("doi")),
        "oa_url": _missing_ratio(final, lambda paper: not paper.get("oa_url") and not paper.get("pdf_url")),
        "topics": _missing_ratio(final, lambda paper: not paper.get("topics")),
    }
    remaining = budget_remaining
    meta = {
        "origin": origin,
        "seed_id": seed["id"],
        "seed_query": query,
        "seed_title": seed["title"],
        "parsed_kind": parsed["kind"],
        "parsed_value": parsed["value"],
        "fetched_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "impact_year": impact_year,
        "sources": sources,
        "paper_count": len(final),
        "fetched_records": fetched_records,
        "after_dedup": len(records),
        "deduped": deduped,
        "skipped_records": skipped,
        "limit": limit,
        "api_calls": api_calls,
        "cache_hits": cache_hits,
        "cocitation_denominator": denominator,
        "cocitation_max": max_count,
        "cocitation_available": coco_available,
        "field_missing": missing,
        "relation_counts": relation_counts,
        "edge_count": len(edges),
        "warnings": warnings,
        "relevance_weights": {
            "direct": 0.30,
            "coupling": 0.26,
            "cocitation": 0.16,
            "topic": 0.14,
            "text": 0.10,
            "related": 0.04,
        },
        "dedup_rule": "按 OpenAlex ID、DOI，以及长度不少于 12 的规范化标题合并；标题相同且年份相差不超过 1 年视为同一篇。保留引用数更高的记录。若另一版本是期刊或会议，且引用数不低于一半，则改用该来源名称。",
        "expansion": "从种子的参考文献、按引用数排序的施引论文、OpenAlex related_works、主主题下的高被引论文，以及施引论文参考文献里与种子共引最多的论文中选取。",
        "impact_definition": "impact_score 等于 OpenAlex cited_by_count。年均引用等于 cited_by_count / max(1, impact_year - year)。",
        "relevance_definition": "relevance = 0.30·直接引用 + 0.26·参考文献 Jaccard + 0.16·共引比例 + 0.14·主题重叠 + 0.10·标题与摘要词袋余弦 + 0.04·OpenAlex related_works。种子为 1。",
        "limitations": LIMITATIONS,
        "openalex_budget_remaining_usd": remaining,
    }
    final.sort(key=lambda paper: (not paper["is_seed"], -(paper.get("relevance_score") or 0), -(paper.get("cited_by_count") or 0)))
    return {"meta": meta, "papers": final, "edges": edges}


def validate_graph(graph: dict) -> dict:
    papers = graph.get("papers") or []
    if len(papers) < 30:
        raise RuntimeError(f"论文太少：{len(papers)}")
    ids = [paper.get("id") for paper in papers]
    if any(not paper_id for paper_id in ids) or len(ids) != len(set(ids)):
        raise RuntimeError("存在缺失或重复的论文 ID")
    idset = set(ids)
    seeds = [paper for paper in papers if paper.get("is_seed")]
    if len(seeds) != 1:
        raise RuntimeError(f"种子论文数量不是 1：{len(seeds)}")
    for paper in papers:
        if not paper.get("title"):
            raise RuntimeError("存在空标题")
        score = paper.get("relevance_score")
        if score is None or score < 0 or score > 1:
            raise RuntimeError(f"相关度超出范围：{paper.get('title')}")
        cited = paper.get("cited_by_count")
        if cited is not None and cited < 0:
            raise RuntimeError("引用数为负")
    for edge in graph.get("edges") or []:
        if edge.get("source") not in idset or edge.get("target") not in idset:
            raise RuntimeError("边的端点不在论文集合中")
        if edge.get("type") not in {"citation", "similarity"}:
            raise RuntimeError("未知边类型")
    return seeds[0]
