/** Shared filters for the timeline and the network. */

export function impactValue(paper, mode) {
  return mode === "per_year" ? paper.impact_per_year : paper.cited_by_count;
}

export function applyFilters(papers, filters) {
  const keyword = (filters.keyword || "").trim().toLowerCase();
  const topics = new Set(filters.topics || []);
  const hidden = new Set(filters.hiddenVenues || []);
  const narrowed = filters.yearMin > filters.dataYearMin || filters.yearMax < filters.dataYearMax;
  const matched = [];
  for (const paper of papers) {
    if (!Number.isFinite(paper.year)) {
      if (narrowed) continue;
    } else if (paper.year < filters.yearMin || paper.year > filters.yearMax) {
      continue;
    }
    if (keyword) {
      const haystack = [
        paper.title,
        paper.author_string,
        paper.abstract,
        paper.venue,
        paper.doi,
        paper.arxiv_id,
        ...(paper.topics || []),
      ].filter(Boolean).join("\n").toLowerCase();
      if (!haystack.includes(keyword)) continue;
    }
    if (topics.size) {
      const names = new Set(paper.topics || []);
      let hit = false;
      for (const topic of topics) if (names.has(topic)) hit = true;
      if (!hit) continue;
    }
    const metric = impactValue(paper, filters.impactMode);
    if ((filters.minImpact || 0) > 0 && !(metric >= filters.minImpact)) continue;
    if (!filters.skipVenue && hidden.has(paper.venue_group || "Unknown")) continue;
    matched.push(paper);
  }
  const center = papers.find((paper) => paper.id === filters.centerId);
  let centerOutside = false;
  if (center && !matched.some((paper) => paper.id === center.id)) {
    matched.push(center);
    centerOutside = true;
  }
  const score = (paper) => {
    const value = impactValue(paper, filters.impactMode);
    return value == null ? -1 : value;
  };
  matched.sort((a, b) => score(b) - score(a) || (b.relevance_score || 0) - (a.relevance_score || 0));
  const limit = filters.skipTopN || !(filters.topN > 0) ? matched.length : filters.topN;
  const centerRows = [];
  const rest = [];
  for (const paper of matched) {
    if (paper.id === filters.centerId) centerRows.push(paper);
    else rest.push(paper);
  }
  return {
    papers: [...centerRows, ...rest.slice(0, Math.max(0, limit - centerRows.length))],
    centerOutside,
    matchedCount: matched.length,
  };
}

export function neighborIds(edges, selectedId) {
  const neighbors = new Set();
  if (!selectedId) return neighbors;
  for (const edge of edges || []) {
    if (edge.source === selectedId) neighbors.add(edge.target);
    else if (edge.target === selectedId) neighbors.add(edge.source);
  }
  return neighbors;
}

export function topTopics(papers, limit = 12) {
  const counts = new Map();
  for (const paper of papers) {
    for (const topic of paper.topics || []) counts.set(topic, (counts.get(topic) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
