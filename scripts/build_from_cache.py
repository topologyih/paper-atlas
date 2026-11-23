#!/usr/bin/env python3
"""Build a partial sample from OpenAlex responses already stored in cache/.

This does not call the network. It keeps only the cached seed and citing
papers, then overwrites public/sample.json and docs/build_report.md. The checked-in
sample is a complete 120-paper fetch, so this script refuses to replace it
unless --force is passed.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from paperatlas.expand import assemble_graph, validate_graph
from paperatlas.parse import parse_query
from paperatlas.report import render_report
from paperatlas.textutil import short_id


def load_cached_works(cache_dir: Path):
    seed = None
    citers = []
    for path in sorted(cache_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("results") if isinstance(payload, dict) and "results" in payload else [payload]
        rows = [row for row in rows if isinstance(row, dict) and row.get("id")]
        if not rows:
            continue
        titles = " ".join((row.get("display_name") or "") for row in rows[:3]).lower()
        if len(rows) == 1 and "attention is all you need" in titles:
            seed = rows[0]
        else:
            citers.extend(rows)
    return seed, citers


def main() -> int:
    parser = argparse.ArgumentParser(description="用本地缓存重写一份不完整的示例图谱")
    parser.add_argument(
        "--force",
        action="store_true",
        help="覆盖 public/sample.json 和 docs/build_report.md",
    )
    args = parser.parse_args()
    out = ROOT / "public" / "sample.json"
    if out.exists() and not args.force:
        print(
            "已有 public/sample.json。这个脚本只会保留缓存里的种子和施引论文，"
            "参考文献、相关论文不会成为节点。确认要覆盖时加上 --force。",
            file=sys.stderr,
        )
        return 1
    query = "10.48550/arXiv.1706.03762"
    cache_dir = ROOT / "cache" / "openalex"
    seed, citers = load_cached_works(cache_dir)
    if not seed:
        print("缓存里没有种子论文", file=sys.stderr)
        return 1
    seed_short = short_id(seed.get("id"))
    counts: Counter[str] = Counter()
    denominator = 0
    for work in citers:
        seen = set()
        refs = []
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
    warnings = [
        "OpenAlex 匿名额度在抓取参考文献之前用完，这份样例只包含种子论文和已缓存的高被引施引论文。",
        "种子的参考文献 ID 仍参与 Jaccard 和共引计算，但那些参考文献没有单独成为节点。",
        "配置 OPENALEX_API_KEY 后重新运行 scripts/fetch_graph.py，可以补上参考文献、相关论文和同主题论文。",
    ]
    graph = assemble_graph(
        query=query,
        parsed=parse_query(query),
        seed_work=seed,
        seed_short=seed_short,
        citers=citers,
        references=[],
        related=[],
        topic_works=[],
        extra=[],
        counts=counts,
        denominator=denominator,
        impact_year=2026,
        limit=120,
        origin="sample",
        sources=["OpenAlex"],
        warnings=warnings,
        api_calls=0,
        cache_hits=3,
        budget_remaining="0",
        must_keep={seed_short},
    )
    graph["meta"]["expansion"] = (
        "本次样例来自已缓存的 OpenAlex 响应：种子论文，以及按引用数排序的两页施引论文。"
        "参考文献、related_works 和主题扩展没有写入节点。"
    )
    seed_paper = validate_graph(graph)
    if "attention is all you need" not in seed_paper["title"].lower():
        print(seed_paper["title"], file=sys.stderr)
        return 1
    out.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = ROOT / "docs" / "build_report.md"
    report.write_text(render_report(graph), encoding="utf-8")
    print(
        f"写出 {out} ，{graph['meta']['paper_count']} 篇，去重 {graph['meta']['deduped']} ，"
        f"施引缓存 {len(citers)} 条"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
