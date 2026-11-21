#!/usr/bin/env python3
"""Fetch a real citation neighborhood and write sample JSON plus build_report.md.

Example:
  python3 scripts/fetch_graph.py --query 10.48550/arXiv.1706.03762 --limit 120
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))

from paperatlas.client import OpenAlexClient, OpenAlexError
from paperatlas.expand import build_graph, validate_graph
from paperatlas.report import render_report


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch a PaperAtlas graph from OpenAlex")
    parser.add_argument("--query", required=True, help="DOI, arXiv, title, or paper URL")
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--out", default=str(ROOT / "public" / "sample.json"))
    parser.add_argument("--report", default=str(ROOT / "build_report.md"))
    parser.add_argument("--cache", default=str(ROOT / "cache" / "openalex"))
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    client = OpenAlexClient(args.cache, refresh=args.refresh)

    def progress(message: str) -> None:
        print(message, flush=True)

    try:
        graph = build_graph(
            args.query,
            limit=args.limit,
            client=client,
            progress=progress,
            origin="sample",
        )
    except OpenAlexError as error:
        print(f"抓取失败：{error}", file=sys.stderr)
        return 1
    seed = validate_graph(graph)
    if "attention is all you need" in args.query.lower() or "1706.03762" in args.query:
        if "attention is all you need" not in seed["title"].lower():
            print(f"种子标题异常：{seed['title']}", file=sys.stderr)
            return 1
        if (seed.get("cited_by_count") or 0) < 50000:
            print(f"种子引用数异常：{seed.get('cited_by_count')}", file=sys.stderr)
            return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    report = Path(args.report)
    report.write_text(render_report(graph), encoding="utf-8")
    print(
        f"写出 {out} ，{graph['meta']['paper_count']} 篇，去重 {graph['meta']['deduped']} ，"
        f"请求 {graph['meta']['api_calls']} 次，缓存命中 {graph['meta']['cache_hits']} 次"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
