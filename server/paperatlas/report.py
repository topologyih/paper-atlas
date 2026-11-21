"""Write build_report.md from a graph that was actually fetched."""

from __future__ import annotations

from .score import RELEVANCE_WEIGHTS


def render_report(graph: dict) -> str:
    meta = graph["meta"]
    papers = graph["papers"]
    missing = meta.get("field_missing") or {}
    relations = meta.get("relation_counts") or {}
    seed = next(paper for paper in papers if paper.get("is_seed"))
    top_relevance = sorted(papers, key=lambda paper: -(paper.get("relevance_score") or 0))[:12]
    top_cited = sorted(papers, key=lambda paper: -(paper.get("cited_by_count") or 0))[:12]

    def row(paper: dict) -> str:
        year = paper.get("year") if paper.get("year") is not None else "Unknown"
        cited = paper.get("cited_by_count") if paper.get("cited_by_count") is not None else "Unknown"
        return (
            f"| {paper['title'].replace('|', '/')} | {year} | {cited} | "
            f"{paper.get('relevance_score')} | {paper.get('relation')} | {paper.get('venue_short') or paper.get('venue')} |"
        )

    missing_lines = "\n".join(
        f"| {name} | {ratio:.1%} |" for name, ratio in missing.items()
    )
    relation_lines = "\n".join(
        f"| {name} | {count} |" for name, count in sorted(relations.items(), key=lambda item: -item[1])
    )
    warning_lines = "\n".join(f"- {warning}" for warning in meta.get("warnings") or []) or "- 无"
    limitation_lines = "\n".join(f"- {item}" for item in meta.get("limitations") or [])
    weight_text = "、".join(f"{key} {value}" for key, value in RELEVANCE_WEIGHTS.items())
    return f"""# 抓取报告

种子论文：{seed['title']}
种子 ID：{seed['id']}
查询：{meta.get('seed_query')}（识别为 {meta.get('parsed_kind')} / {meta.get('parsed_value')}）
抓取时间：{meta.get('fetched_at')}
影响力年份：{meta.get('impact_year')}
数据来源：{', '.join(meta.get('sources') or [])}

## 数量

| 项目 | 数量 |
| --- | ---: |
| 请求上限 | {meta.get('limit')} |
| 清洗前记录（含重复） | {meta.get('fetched_records')} |
| 去重后 | {meta.get('after_dedup')} |
| 去掉的重复记录 | {meta.get('deduped')} |
| 因类型、撤稿或空标题跳过 | {meta.get('skipped_records')} |
| 写入图谱 | {meta.get('paper_count')} |
| 边 | {meta.get('edge_count')} |
| 实际请求 OpenAlex 次数 | {meta.get('api_calls')} |
| 命中本地缓存 | {meta.get('cache_hits')} |
| 共引分母（有参考文献的施引论文） | {meta.get('cocitation_denominator')} |

OpenAlex 返回的剩余额度（美元，匿名池按 IP 共享）：{meta.get('openalex_budget_remaining_usd') or 'Unknown'}

## 与种子的主要关系

| 关系 | 篇数 |
| --- | ---: |
{relation_lines}

一篇论文只计入一种主要关系。优先级是：种子、互引、参考文献、施引、OpenAlex 相关、共引、同主题、文本相近。

## 字段缺失比例

分母是写入图谱的论文。缺失指空值或来源名为 Unknown，不是字符串 "0"。

| 字段 | 缺失比例 |
| --- | ---: |
{missing_lines}

## 相关度最高的论文

| 标题 | 年份 | 引用 | 相关度 | 关系 | 来源 |
| --- | ---: | ---: | ---: | --- | --- |
{chr(10).join(row(paper) for paper in top_relevance)}

## 引用数最高的论文

| 标题 | 年份 | 引用 | 相关度 | 关系 | 来源 |
| --- | ---: | ---: | ---: | --- | --- |
{chr(10).join(row(paper) for paper in top_cited)}

## 规则

去重：{meta.get('dedup_rule')}

扩展：{meta.get('expansion')}

影响力：{meta.get('impact_definition')}

相关度权重：{weight_text}。{meta.get('relevance_definition')}

## 本次警告

{warning_lines}

## 已知问题

{limitation_lines}

- 匿名 OpenAlex 额度大约是每个 IP 每天 0.10 美元，标题检索在高负载时会暂停。页面内置了这次抓取的样例，接口失败时仍可浏览。
- 配置 `OPENALEX_API_KEY` 后进入约 1 美元/天的免费额度。不要编造邮箱去申请 key。
- 期刊名称沿用 OpenAlex 的来源名，长名称会截成缩写只用于图例；详情里保留清洗后的全称。
"""
