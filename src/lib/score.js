/** Relevance and sparse edges. Weights match tests/fixtures/weights.json. */

import { cosine, jaccard, tokenize } from "./text.js";

export const RELEVANCE_WEIGHTS = {
  direct: 0.3,
  coupling: 0.26,
  cocitation: 0.16,
  topic: 0.14,
  text: 0.1,
  related: 0.04,
};

const RELATION_PRIORITY = ["seed", "both", "reference", "citing", "related", "cocitation", "topic", "semantic"];

export const RELATION_LABELS = {
  seed: "种子论文",
  both: "互引",
  reference: "种子的参考文献",
  citing: "引用种子的论文",
  related: "OpenAlex 相关论文",
  cocitation: "共引论文",
  topic: "同主题论文",
  semantic: "文本相近论文",
};

export function impactPerYear(citedByCount, year, impactYear) {
  if (citedByCount == null || year == null) return null;
  return Math.round((Number(citedByCount) / Math.max(1, impactYear - year)) * 100) / 100;
}

export function relationLabels(record, seedRelated) {
  if (record.is_seed) return ["seed"];
  const labels = [];
  if (record.cites_seed && record.cited_by_seed) labels.push("both");
  else if (record.cited_by_seed) labels.push("reference");
  else if (record.cites_seed) labels.push("citing");
  if (seedRelated?.has?.(record.id) || (record.origin_tags || []).includes("related")) labels.push("related");
  if ((record.cocitation_count || 0) >= 3) labels.push("cocitation");
  if (record.topic_overlap) labels.push("topic");
  if (!labels.length) labels.push("semantic");
  const order = new Map(RELATION_PRIORITY.map((name, index) => [name, index]));
  return [...new Set(labels)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

export function scoreRelevance(paper, center, { cocoScore = 0, cocoAvailable = true, paperTokens, centerTokens } = {}) {
  if (paper.id === center.id) {
    return {
      score: 1,
      parts: { direct: 1, coupling: 1, cocitation: 1, topic: 1, text: 1, related: 1 },
      weights: { ...RELEVANCE_WEIGHTS },
    };
  }
  const centerRefs = new Set(center.referenced_works || []);
  const paperRefs = new Set(paper.referenced_works || []);
  const direct = centerRefs.has(paper.id) || paperRefs.has(center.id) ? 1 : 0;
  const coupling = jaccard(centerRefs, paperRefs);
  const centerTopics = (center.topic_ids || []).filter(Boolean);
  const paperTopics = new Set(paper.topic_ids || []);
  const topic = centerTopics.length
    ? centerTopics.filter((topicId) => paperTopics.has(topicId)).length / centerTopics.length
    : 0;
  const text = cosine(
    paperTokens || tokenize(paper.title, paper.abstract),
    centerTokens || tokenize(center.title, center.abstract),
  );
  const related = new Set(center.related_works || []).has(paper.id) ? 1 : 0;
  const coco = Math.max(0, Math.min(1, Number(cocoScore) || 0));
  const parts = {
    direct,
    coupling,
    cocitation: cocoAvailable ? coco : 0,
    topic,
    text,
    related,
  };
  let weights = { ...RELEVANCE_WEIGHTS };
  if (!cocoAvailable) {
    weights.cocitation = 0;
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
    weights = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value / total]));
  }
  const score = Math.max(0, Math.min(1, Object.keys(weights).reduce((sum, key) => sum + weights[key] * parts[key], 0)));
  const round = (value) => Math.round(value * 10000) / 10000;
  return {
    score: round(score),
    parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, round(value)])),
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, round(value)])),
  };
}

export function buildEdges(papers, seedId, { k = 2, maxEdges = 900 } = {}) {
  const refsets = new Map(papers.map((paper) => [paper.id, new Set(paper.referenced_works || [])]));
  const tokens = new Map(papers.map((paper) => [paper.id, tokenize(paper.title, paper.abstract)]));
  const edges = new Map();

  function add(source, target, kind, weight) {
    if (source === target) return;
    const pair = [source, target].sort();
    if (kind === "similarity" && edges.has(`${pair[0]}|${pair[1]}|citation`)) return;
    const key = `${pair[0]}|${pair[1]}|${kind}`;
    const rounded = Math.round(weight * 10000) / 10000;
    const current = edges.get(key);
    if (current) {
      current.weight = Math.max(current.weight, rounded);
      return;
    }
    edges.set(key, { source: pair[0], target: pair[1], type: kind, weight: rounded });
  }

  const ids = papers.map((paper) => paper.id);
  for (let i = 0; i < ids.length; i += 1) {
    const left = ids[i];
    const leftRefs = refsets.get(left);
    for (let j = i + 1; j < ids.length; j += 1) {
      const right = ids[j];
      if (leftRefs.has(right) || refsets.get(right).has(left)) add(left, right, "citation", 1);
    }
  }

  for (const left of ids) {
    const ranked = [];
    for (const right of ids) {
      if (left === right) continue;
      const coupling = jaccard(refsets.get(left), refsets.get(right));
      const text = cosine(tokens.get(left), tokens.get(right));
      if (coupling < 0.03 && text < 0.5) continue;
      ranked.push([0.7 * coupling + 0.3 * text, right]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    const limit = left === seedId ? k + 1 : k;
    for (const [weight, right] of ranked.slice(0, limit)) add(left, right, "similarity", weight);
  }

  const listed = [...edges.values()];
  if (listed.length <= maxEdges) return listed;
  listed.sort((a, b) => {
    const incident = (edge) => edge.source === seedId || edge.target === seedId;
    return Number(incident(b)) - Number(incident(a))
      || Number(b.type === "citation") - Number(a.type === "citation")
      || b.weight - a.weight;
  });
  return listed.slice(0, maxEdges);
}

export function cocitationIndex(papers, centerId) {
  const counts = new Map();
  let denominator = 0;
  for (const paper of papers) {
    if (paper.id === centerId) continue;
    const refs = paper.referenced_works || [];
    if (!refs.includes(centerId)) continue;
    denominator += 1;
    for (const ref of new Set(refs)) {
      if (ref !== centerId) counts.set(ref, (counts.get(ref) || 0) + 1);
    }
  }
  return { counts, denominator };
}

export function rescorePapers(papers, centerId) {
  const center = papers.find((paper) => paper.id === centerId);
  if (!center) return papers;
  const { counts, denominator } = cocitationIndex(papers, centerId);
  const cocoAvailable = denominator >= 5;
  const centerTokens = tokenize(center.title, center.abstract);
  return papers.map((paper) => {
    const coco = denominator ? (counts.get(paper.id) || 0) / denominator : 0;
    const scored = scoreRelevance(paper, center, {
      cocoScore: coco,
      cocoAvailable,
      centerTokens,
    });
    return {
      ...paper,
      relevance_score: scored.score,
      relevance_parts: scored.parts,
    };
  });
}
