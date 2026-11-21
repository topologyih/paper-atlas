/** Live graph builder. Same neighborhood rules as server/paperatlas/expand.py. */

import { dedupRecords, recordFromWork } from "./normalize.js";
import { ApiError, createOpenAlex, serverAvailable } from "./openalex.js";
import { findArxiv, findDoi, parseQuery } from "./parseInput.js";
import { buildEdges, relationLabels, rescorePapers, scoreRelevance } from "./score.js";
import { shortId, titleKey, tokenize } from "./text.js";

const LIMITATIONS = [
  "引用数、参考文献和主题来自 OpenAlex，不等于 Google Scholar 的引用数。",
  "相关度由直接引用、参考文献 Jaccard、共引比例、主题重叠和词袋余弦组成，不是神经网络向量。",
  "共引比例的分母是本次抓到的施引论文，不是全部施引文献。",
  "缺失字段保持为空，界面显示 Unknown，不会编造摘要或引用数。",
];

export function expansionPlan(limit) {
  if (limit <= 50) return { citerPages: 1, perPage: 40, refCap: 40, cocoCap: 20, topic: 20 };
  if (limit <= 100) return { citerPages: 2, perPage: 50, refCap: 70, cocoCap: 30, topic: 30 };
  if (limit <= 180) return { citerPages: 2, perPage: 50, refCap: 90, cocoCap: 40, topic: 40 };
  if (limit <= 300) return { citerPages: 3, perPage: 80, refCap: 100, cocoCap: 50, topic: 40 };
  return { citerPages: 4, perPage: 100, refCap: 120, cocoCap: 60, topic: 50 };
}

function bestWork(works) {
  if (!works?.length) return null;
  return [...works].sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0))[0];
}

async function fetchByDoi(client, doi, signal) {
  const payload = await client.get("/works", { filter: `doi:${doi}`, "per-page": 5, select: client.select }, { signal });
  return bestWork(payload.results || []);
}

async function fetchByArxiv(client, arxivId, signal) {
  const payload = await client.get("/works", { filter: `ids.arxiv:${arxivId}`, "per-page": 5, select: client.select }, { signal });
  return bestWork(payload.results || []);
}

async function fetchByOpenAlex(client, id, signal) {
  try {
    const payload = await client.get(`/works/${id}`, { select: client.select }, { signal });
    if (payload?.id) return payload;
    return bestWork(payload.results || []);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function fetchBatch(client, ids, signal) {
  const unique = [];
  const seen = new Set();
  for (const value of ids) {
    const token = shortId(value);
    if (token && !seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }
  const works = [];
  for (let start = 0; start < unique.length; start += 50) {
    const chunk = unique.slice(start, start + 50);
    const payload = await client.get("/works", {
      filter: `openalex:${chunk.join("|")}`,
      "per-page": chunk.length,
      select: client.select,
    }, { signal });
    works.push(...(payload.results || []));
  }
  return works;
}

function candidateOf(work) {
  const authors = [];
  for (const authorship of (work.authorships || []).slice(0, 4)) {
    const name = authorship?.author?.display_name || authorship?.raw_author_name;
    if (name) authors.push(name);
  }
  return {
    id: shortId(work.id),
    title: work.display_name || "Unknown",
    year: work.publication_year ?? null,
    cited_by_count: work.cited_by_count ?? null,
    authors,
  };
}

function matchTitle(query, results) {
  const key = titleKey(query);
  const exact = results.filter((work) => titleKey(work.display_name) === key && key.length >= 12);
  if (exact.length) return { status: "one", work: bestWork(exact) };
  const queryTokens = new Set(Object.keys(tokenize(query, null)));
  const scored = results.map((work) => {
    const tokens = new Set(Object.keys(tokenize(work.display_name, null)));
    let overlap = 0;
    if (queryTokens.size) {
      for (const token of queryTokens) if (tokens.has(token)) overlap += 1;
      overlap /= queryTokens.size;
    }
    return { overlap, cited: work.cited_by_count || 0, work };
  }).sort((a, b) => b.overlap - a.overlap || b.cited - a.cited);
  if (!scored.length || scored[0].overlap < 0.45) return { status: "none" };
  const close = scored.filter((item) => item.overlap >= Math.max(0.45, scored[0].overlap - 0.08));
  if (close.length === 1 || (close[0].overlap >= close[1].overlap + 0.2 && close[0].overlap >= 0.6)) {
    return { status: "one", work: close[0].work };
  }
  return { status: "many", works: close.slice(0, 5).map((item) => item.work) };
}

async function crossrefSearch(title, signal) {
  const url = `https://api.crossref.org/works?${new URLSearchParams({ "query.bibliographic": title, rows: "5" })}`;
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) return [];
  const payload = await response.json();
  return payload?.message?.items || [];
}

async function semanticSearch(title, signal) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${new URLSearchParams({
    query: title,
    limit: "5",
    fields: "title,year,externalIds,citationCount,authors",
  })}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return [];
  const payload = await response.json();
  return payload.data || [];
}

async function semanticPaper(id, signal) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=title,year,externalIds,citationCount,authors`;
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return response.json();
}

async function resolveTitle(client, title, signal, warnings, sources) {
  let results = [];
  try {
    const payload = await client.get("/works", { search: title, "per-page": 8, select: client.select }, { signal });
    results = payload.results || [];
  } catch (error) {
    if (error instanceof ApiError && /标题检索/.test(error.message)) {
      warnings.push(`${error.message}`);
    } else {
      throw error;
    }
  }
  if (results.length) {
    const matched = matchTitle(title, results);
    if (matched.status === "one") return matched.work;
    if (matched.status === "many") throw new ApiError("找到多篇可能的论文", { candidates: matched.works.map(candidateOf) });
  }
  try {
    for (const item of await crossrefSearch(title, signal)) {
      const doi = String(item.DOI || "").toLowerCase();
      if (!doi) continue;
      const work = await fetchByDoi(client, doi, signal);
      if (work) {
        if (!sources.includes("Crossref")) sources.push("Crossref");
        warnings.push(`标题通过 Crossref DOI ${doi} 定位到 OpenAlex。`);
        return work;
      }
    }
  } catch {
    warnings.push("Crossref 标题检索失败。");
  }
  try {
    for (const item of await semanticSearch(title, signal)) {
      const external = item.externalIds || {};
      let work = external.DOI ? await fetchByDoi(client, String(external.DOI).toLowerCase(), signal) : null;
      if (!work && external.ArXiv) work = await fetchByArxiv(client, external.ArXiv, signal);
      if (work) {
        if (!sources.includes("Semantic Scholar")) sources.push("Semantic Scholar");
        warnings.push("标题通过 Semantic Scholar 定位到 OpenAlex。");
        return work;
      }
    }
  } catch {
    warnings.push("Semantic Scholar 标题检索失败。");
  }
  return null;
}

async function resolveSeed(client, query, signal, warnings, sources) {
  const parsed = parseQuery(query);
  if (parsed.kind === "invalid") throw new ApiError("请输入 DOI、arXiv、标题或论文 URL");
  let work = null;
  if (parsed.kind === "doi") work = await fetchByDoi(client, parsed.value, signal);
  else if (parsed.kind === "arxiv") work = await fetchByArxiv(client, parsed.value, signal);
  else if (parsed.kind === "openalex") work = await fetchByOpenAlex(client, parsed.value, signal);
  else if (parsed.kind === "s2") {
    const paper = await semanticPaper(parsed.value, signal);
    const external = paper?.externalIds || {};
    if (external.DOI) work = await fetchByDoi(client, String(external.DOI).toLowerCase(), signal);
    if (!work && external.ArXiv) work = await fetchByArxiv(client, external.ArXiv, signal);
    if (!work && paper?.title) work = await resolveTitle(client, paper.title, signal, warnings, sources);
    if (paper) sources.push("Semantic Scholar");
  } else if (parsed.kind === "url") {
    const inline = parseQuery(parsed.value);
    if (inline.kind === "doi") work = await fetchByDoi(client, inline.value, signal);
    else if (inline.kind === "arxiv") work = await fetchByArxiv(client, inline.value, signal);
    else if (inline.kind === "openalex") work = await fetchByOpenAlex(client, inline.value, signal);
    else {
      try {
        const response = await fetch(parsed.value, { signal });
        const page = response.ok ? await response.text() : "";
        const doi = findDoi(page.slice(0, 8000));
        const arxiv = findArxiv(page.slice(0, 4000), { bare: false });
        if (doi) work = await fetchByDoi(client, doi, signal);
        if (!work && arxiv) work = await fetchByArxiv(client, arxiv, signal);
      } catch {
        warnings.push("这个 URL 不能在浏览器里读取。请改用 DOI，或启动本地服务后再试。");
      }
    }
  } else if (parsed.kind === "title") {
    work = await resolveTitle(client, parsed.value, signal, warnings, sources);
  }
  if (!work) throw new ApiError("没有在 OpenAlex 中定位到这篇论文。可以换一个 DOI，或先查看内置示例。");
  return { work, parsed };
}

function collect(works, label, impactYear, mustKeep, force = false) {
  const records = [];
  let skipped = 0;
  for (const work of works) {
    const record = recordFromWork(work, impactYear, { force, mustKeep });
    if (!record) {
      skipped += 1;
      continue;
    }
    record.origin_tags = [label];
    records.push(record);
  }
  return { records, skipped };
}

function selectFinal(records, seedId, limit) {
  const seed = records.find((record) => record.id === seedId);
  const others = records.filter((record) => record.id !== seedId);
  if (records.length <= limit) {
    others.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    return [seed, ...others];
  }
  const budget = Math.max(1, limit - 1);
  const references = others.filter((record) => record.cited_by_seed)
    .sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  const citers = others.filter((record) => record.cites_seed && !record.cited_by_seed)
    .sort((a, b) => (b.cited_by_count || 0) - (a.cited_by_count || 0));
  const related = others.filter((record) => (record.origin_tags || []).includes("related") && !record.cites_seed && !record.cited_by_seed);
  let refSlots = Math.min(references.length, Math.max(8, Math.round(budget * 0.28)));
  let citeSlots = Math.min(citers.length, Math.max(8, Math.round(budget * 0.34)));
  let relatedSlots = Math.min(related.length, Math.round(budget * 0.08));
  if (refSlots + citeSlots + relatedSlots > budget) {
    relatedSlots = Math.min(relatedSlots, Math.floor(budget / 10));
    const remaining = budget - relatedSlots;
    refSlots = Math.min(refSlots, Math.floor(remaining / 2));
    citeSlots = Math.min(citeSlots, remaining - refSlots);
  }
  const chosen = [];
  const chosenIds = new Set();
  const take = (items, count) => {
    let got = 0;
    for (const item of items) {
      if (chosenIds.has(item.id)) continue;
      chosen.push(item);
      chosenIds.add(item.id);
      got += 1;
      if (got >= count) break;
    }
  };
  take(references, refSlots);
  take(citers, citeSlots);
  take(related, relatedSlots);
  const rest = others.filter((record) => !chosenIds.has(record.id))
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0) || (b.cited_by_count || 0) - (a.cited_by_count || 0));
  take(rest, Math.max(0, budget - chosen.length));
  return [seed, ...chosen];
}

function missingRatio(papers, predicate) {
  if (!papers.length) return 0;
  return Math.round((papers.filter(predicate).length / papers.length) * 10000) / 10000;
}

export async function buildGraph(query, { limit = 100, onProgress = () => {}, signal, client = createOpenAlex(), origin = "live" } = {}) {
  const impactYear = new Date().getFullYear();
  const bounded = Math.max(10, Math.min(Number(limit) || 100, 500));
  const plan = expansionPlan(bounded);
  const warnings = [];
  const sources = ["OpenAlex"];
  onProgress({ id: "seed", message: "识别输入并获取种子论文" });
  const { work: seedWork, parsed } = await resolveSeed(client, query, signal, warnings, sources);
  const seedShort = shortId(seedWork.id);
  const mustKeep = new Set([seedShort]);
  onProgress({ id: "citers", message: "扩展施引文献" });
  const citers = [];
  for (let page = 1; page <= plan.citerPages; page += 1) {
    try {
      const payload = await client.get("/works", {
        filter: `cites:${seedShort}`,
        sort: "cited_by_count:desc",
        "per-page": plan.perPage,
        page,
        select: client.select,
      }, { signal });
      const rows = payload.results || [];
      citers.push(...rows);
      if (rows.length < plan.perPage) break;
    } catch (error) {
      warnings.push(`施引文献第 ${page} 页没有取回：${error.message}`);
      break;
    }
  }
  onProgress({ id: "refs", message: "获取参考文献与相关论文" });
  const refIds = [];
  for (const value of seedWork.referenced_works || []) {
    const token = shortId(value);
    if (token && !refIds.includes(token)) refIds.push(token);
    if (refIds.length >= plan.refCap) break;
  }
  const relatedIds = [];
  for (const value of seedWork.related_works || []) {
    const token = shortId(value);
    if (token && !relatedIds.includes(token)) relatedIds.push(token);
  }
  const references = refIds.length ? await fetchBatch(client, refIds, signal) : [];
  const related = relatedIds.length ? await fetchBatch(client, relatedIds, signal) : [];
  onProgress({ id: "topic", message: "补充主题与共引论文" });
  let topicWorks = [];
  const topicId = shortId(seedWork.topics?.[0]?.id);
  if (topicId) {
    const year = seedWork.publication_year || impactYear;
    try {
      const payload = await client.get("/works", {
        filter: `topics.id:${topicId},publication_year:${year - 3}-${year + 8},cited_by_count:>40`,
        sort: "cited_by_count:desc",
        "per-page": plan.topic,
        select: client.select,
      }, { signal });
      topicWorks = payload.results || [];
    } catch (error) {
      warnings.push(`主题扩展失败：${error.message}`);
    }
  }
  const counts = new Map();
  let denominator = 0;
  for (const work of citers) {
    const refs = [];
    const seen = new Set();
    for (const value of work.referenced_works || []) {
      const token = shortId(value);
      if (token && !seen.has(token)) {
        seen.add(token);
        refs.push(token);
      }
    }
    if (!refs.length) continue;
    denominator += 1;
    for (const token of refs) {
      if (token !== seedShort) counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  const already = new Set([seedShort]);
  for (const work of [...citers, ...references, ...related, ...topicWorks]) {
    const token = shortId(work.id);
    if (token) already.add(token);
  }
  const extraIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([token, count]) => count >= 2 && !already.has(token))
    .slice(0, plan.cocoCap)
    .map(([token]) => token);
  const extra = extraIds.length ? await fetchBatch(client, extraIds, signal) : [];
  onProgress({ id: "score", message: "去重并计算相关度" });
  const groups = [
    collect([seedWork], "seed", impactYear, mustKeep, true),
    collect(citers, "citing", impactYear, mustKeep),
    collect(references, "reference", impactYear, mustKeep),
    collect(related, "related", impactYear, mustKeep),
    collect(topicWorks, "topic", impactYear, mustKeep),
    collect(extra, "cocitation", impactYear, mustKeep),
  ];
  let records = [];
  let skipped = 0;
  for (const group of groups) {
    records.push(...group.records);
    skipped += group.skipped;
  }
  const fetchedRecords = records.length;
  records = dedupRecords(records, mustKeep, impactYear);
  const deduped = fetchedRecords - records.length;
  let seed = records.find((record) => record.id === seedShort || (record.alternate_ids || []).includes(seedShort) || (record.origin_tags || []).includes("seed"));
  if (!seed) throw new ApiError("种子论文在去重后丢失");
  seed.is_seed = true;
  const seedIds = new Set([seed.id, seedShort, ...(seed.alternate_ids || [])]);
  const seedRefs = new Set(seed.referenced_works || []);
  const seedTopics = new Set(seed.topic_ids || []);
  const seedRelated = new Set(seed.related_works || []);
  for (const record of records) {
    const identity = new Set([record.id, ...(record.alternate_ids || [])]);
    record.cocitation_count = [...identity].reduce((sum, token) => sum + (counts.get(token) || 0), 0);
    record.is_seed = record.id === seed.id;
    record.cited_by_seed = [...identity].some((token) => seedRefs.has(token)) || (record.origin_tags || []).includes("reference");
    record.cites_seed = (record.referenced_works || []).some((token) => seedIds.has(token))
      || ((record.origin_tags || []).includes("citing") && !record.is_seed);
    if (record.is_seed) {
      record.cited_by_seed = false;
      record.cites_seed = false;
    }
    record.topic_overlap = (record.topic_ids || []).filter((topic) => seedTopics.has(topic)).length;
  }
  const cocoAvailable = denominator >= 5;
  const centerTokens = tokenize(seed.title, seed.abstract);
  for (const record of records) {
    const scored = scoreRelevance(record, seed, {
      cocoScore: denominator ? record.cocitation_count / denominator : 0,
      cocoAvailable,
      centerTokens,
    });
    record.relevance_score = scored.score;
    record.relevance_parts = scored.parts;
    record.relations = relationLabels(record, seedRelated);
    record.relation = record.relations[0];
  }
  const papers = selectFinal(records, seed.id, bounded).map((paper) => {
    const copy = { ...paper };
    delete copy.title_key;
    return copy;
  });
  const edges = buildEdges(papers, seed.id);
  if (papers.length < bounded) warnings.push(`清洗后得到 ${papers.length} 篇，少于请求的 ${bounded} 篇。没有用虚构论文补齐。`);
  const relationCounts = {};
  for (const paper of papers) relationCounts[paper.relation] = (relationCounts[paper.relation] || 0) + 1;
  papers.sort((a, b) => Number(b.is_seed) - Number(a.is_seed) || (b.relevance_score || 0) - (a.relevance_score || 0));
  return {
    meta: {
      origin,
      seed_id: seed.id,
      seed_query: query,
      seed_title: seed.title,
      parsed_kind: parsed.kind,
      parsed_value: parsed.value,
      fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      impact_year: impactYear,
      sources,
      paper_count: papers.length,
      fetched_records: fetchedRecords,
      after_dedup: records.length,
      deduped,
      skipped_records: skipped,
      limit: bounded,
      api_calls: client.stats.calls,
      cache_hits: client.stats.cacheHits,
      cocitation_denominator: denominator,
      cocitation_available: cocoAvailable,
      field_missing: {
        authors: missingRatio(papers, (paper) => !paper.authors?.length),
        year: missingRatio(papers, (paper) => paper.year == null),
        venue: missingRatio(papers, (paper) => !paper.venue || paper.venue === "Unknown"),
        cited_by_count: missingRatio(papers, (paper) => paper.cited_by_count == null),
        abstract: missingRatio(papers, (paper) => !paper.abstract),
        doi: missingRatio(papers, (paper) => !paper.doi),
        oa_url: missingRatio(papers, (paper) => !paper.oa_url && !paper.pdf_url),
        topics: missingRatio(papers, (paper) => !paper.topics?.length),
      },
      relation_counts: relationCounts,
      edge_count: edges.length,
      warnings,
      relevance_weights: { direct: 0.3, coupling: 0.26, cocitation: 0.16, topic: 0.14, text: 0.1, related: 0.04 },
      dedup_rule: "按 OpenAlex ID、DOI，以及长度不少于 12 的规范化标题合并；标题相同且年份相差不超过 1 年视为同一篇。",
      expansion: "参考文献、高被引施引论文、OpenAlex related_works、同主题高被引论文，以及与种子共引最多的论文。",
      impact_definition: "impact_score 等于 OpenAlex cited_by_count。年均引用等于 cited_by_count / max(1, impact_year - year)。",
      relevance_definition: "0.30·直接引用 + 0.26·参考文献 Jaccard + 0.16·共引比例 + 0.14·主题重叠 + 0.10·词袋余弦 + 0.04·OpenAlex 相关论文。",
      limitations: LIMITATIONS,
    },
    papers,
    edges,
  };
}

export async function expandAround(graph, paperId, { onProgress = () => {}, signal, add = 40 } = {}) {
  const client = createOpenAlex();
  const impactYear = graph.meta?.impact_year || new Date().getFullYear();
  onProgress({ id: "citers", message: "读取这篇论文的施引文献" });
  let citers = [];
  try {
    const payload = await client.get("/works", {
      filter: `cites:${paperId}`,
      sort: "cited_by_count:desc",
      "per-page": Math.min(add, 50),
      select: client.select,
    }, { signal });
    citers = payload.results || [];
  } catch (error) {
    throw new ApiError(`施引文献没有取回：${error.message}`);
  }
  onProgress({ id: "refs", message: "读取这篇论文的参考文献" });
  const current = graph.papers.find((paper) => paper.id === paperId);
  const refIds = (current?.referenced_works || []).slice(0, add);
  const references = refIds.length ? await fetchBatch(client, refIds, signal) : [];
  const mustKeep = new Set([graph.meta.seed_id, paperId]);
  const incoming = [
    ...collect(citers, "citing", impactYear, mustKeep).records,
    ...collect(references, "reference", impactYear, mustKeep).records,
  ];
  const papers = graph.papers.map((paper) => ({ ...paper, title_key: titleKey(paper.title) }));
  let added = 0;
  for (const record of incoming) {
    const match = papers.find((paper) => (
      paper.id === record.id
      || (paper.doi && paper.doi === record.doi)
      || (paper.title_key && paper.title_key.length >= 12 && paper.title_key === record.title_key && (paper.year == null || record.year == null || Math.abs(paper.year - record.year) <= 1))
    ));
    if (match) {
      if ((record.cited_by_count || 0) > (match.cited_by_count || 0)) {
        match.cited_by_count = record.cited_by_count;
        match.impact_score = record.cited_by_count;
      }
      const seen = new Set(match.referenced_works || []);
      for (const ref of record.referenced_works || []) {
        if (!seen.has(ref) && (match.referenced_works || []).length < 200) {
          match.referenced_works = [...(match.referenced_works || []), ref];
          seen.add(ref);
        }
      }
      continue;
    }
    if (added >= add) continue;
    papers.push(record);
    added += 1;
  }
  onProgress({ id: "score", message: "把新论文并入当前图谱" });
  const centerId = graph.meta.center_id || graph.meta.seed_id;
  const scored = rescorePapers(papers, centerId).map((paper) => {
    const copy = { ...paper };
    delete copy.title_key;
    return copy;
  });
  const edges = buildEdges(scored, centerId);
  return {
    ...graph,
    papers: scored,
    edges,
    meta: {
      ...graph.meta,
      paper_count: scored.length,
      edge_count: edges.length,
      warnings: [...(graph.meta.warnings || []), `已从 ${current?.title || paperId} 加入 ${added} 篇论文。`],
    },
  };
}

export async function loadThroughServer(query, limit) {
  const base = import.meta.env?.VITE_API_BASE ?? "";
  const response = await fetch(`${base}/api/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  const payload = await response.json();
  if (response.status === 409) {
    throw new ApiError(payload?.detail?.message || "找到多篇可能的论文", { candidates: payload?.detail?.candidates || [] });
  }
  if (!response.ok) throw new ApiError(payload?.detail || "本地服务抓取失败");
  return payload;
}

export { serverAvailable };
