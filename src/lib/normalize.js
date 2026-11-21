/** OpenAlex work → paper record, plus the same dedup rules as the Python pipeline. */

import { impactPerYear } from "./score.js";
import {
  authorsFromWork,
  bareDoi,
  capRefs,
  extractArxiv,
  isBadTitle,
  pdfUrls,
  reconstructAbstract,
  shortId,
  titleKey,
  venueFromWork,
  VENUE_RANK,
} from "./text.js";

const ALLOWED_TYPES = new Set([
  "article", "preprint", "review", "book-chapter", "book", "report", "other",
  "conference-paper", "proceedings-article", "posted-content",
]);

export function refList(work) {
  const refs = [];
  for (const value of work?.referenced_works || []) {
    const token = shortId(value);
    if (token) refs.push(token);
  }
  return refs;
}

export function recordFromWork(work, impactYear, { force = false, mustKeep = new Set() } = {}) {
  if (!work?.id) return null;
  if (work.is_retracted && !force) return null;
  const workType = String(work.type || "unknown").toLowerCase();
  if (!ALLOWED_TYPES.has(workType) && !force) return null;
  const title = String(work.display_name || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (isBadTitle(title)) return null;
  const yearValue = work.publication_year;
  const year = Number.isInteger(yearValue) || (typeof yearValue === "string" && /^\d+$/.test(yearValue))
    ? Number(yearValue)
    : null;
  const cited = typeof work.cited_by_count === "number" ? Math.round(work.cited_by_count) : null;
  const doi = bareDoi(work.doi || work.ids?.doi);
  const links = pdfUrls(work);
  const arxivId = extractArxiv(work, doi, links.oa_url, links.landing_url);
  const venue = venueFromWork(work);
  const authors = authorsFromWork(work);
  const topics = [];
  const topicIds = [];
  for (const topic of (work.topics || []).slice(0, 8)) {
    if (topic?.display_name && !topics.includes(topic.display_name)) topics.push(String(topic.display_name));
    const topicToken = shortId(topic?.id);
    if (topicToken && !topicIds.includes(topicToken)) topicIds.push(topicToken);
  }
  let abstract = reconstructAbstract(work.abstract_inverted_index);
  if (abstract && abstract.length > 1500) abstract = `${abstract.slice(0, 1499).trimEnd()}…`;
  const capped = capRefs(refList(work), mustKeep);
  const related = [];
  for (const value of work.related_works || []) {
    const token = shortId(value);
    if (token && !related.includes(token)) related.push(token);
  }
  return {
    id: shortId(work.id),
    title,
    title_key: titleKey(title),
    year,
    publication_date: work.publication_date || null,
    ...authors,
    ...venue,
    cited_by_count: cited,
    impact_score: cited,
    impact_per_year: impactPerYear(cited, year, impactYear),
    abstract,
    doi,
    arxiv_id: arxivId,
    oa_url: links.oa_url,
    pdf_url: links.pdf_url,
    landing_url: links.landing_url || (doi ? `https://doi.org/${doi}` : null),
    topics,
    topic_ids: topicIds,
    keywords: [...topics],
    referenced_works: capped.refs,
    related_works: related.slice(0, 30),
    refs_truncated: capped.truncated,
    type: workType,
    origin_tags: [],
    alternate_ids: [],
    cites_seed: false,
    cited_by_seed: false,
    is_seed: false,
    cocitation_count: 0,
    topic_overlap: 0,
    relations: [],
    relation: "semantic",
    relevance_score: 0,
    relevance_parts: {},
  };
}

export function titlesMatch(left, right) {
  const key = left?.title_key || "";
  if (key.length < 12 || key !== (right?.title_key || "")) return false;
  if (left.year == null || right.year == null) return true;
  return Math.abs(left.year - right.year) <= 1;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value == null || value === "" || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function betterVenue(candidate, current) {
  if (!candidate?.venue || candidate.venue === "Unknown") return false;
  if (!current?.venue || current.venue === "Unknown") return true;
  const candidateRank = VENUE_RANK[candidate.venue_type] ?? 4;
  const currentRank = VENUE_RANK[current.venue_type] ?? 4;
  if (candidateRank >= currentRank) return false;
  const candidateCites = candidate.cited_by_count || 0;
  const currentCites = current.cited_by_count || 0;
  return currentCites === 0 || candidateCites >= 0.5 * currentCites;
}

export function mergeRecords(left, right, mustKeep, impactYear) {
  const leftCites = left.cited_by_count ?? -1;
  const rightCites = right.cited_by_count ?? -1;
  const primary = leftCites >= rightCites ? left : right;
  const secondary = primary === left ? right : left;
  const merged = { ...primary };
  const counts = [left.cited_by_count, right.cited_by_count].filter((value) => value != null);
  merged.cited_by_count = counts.length ? Math.max(...counts) : null;
  merged.impact_score = merged.cited_by_count;
  merged.impact_per_year = impactPerYear(merged.cited_by_count, merged.year, impactYear);
  for (const field of ["abstract", "doi", "arxiv_id", "oa_url", "pdf_url", "landing_url", "publication_date"]) {
    if (!merged[field] && secondary[field]) merged[field] = secondary[field];
  }
  if ((secondary.authors || []).length > (merged.authors || []).length) {
    merged.authors = secondary.authors;
    merged.author_count = Math.max(merged.author_count || 0, secondary.author_count || 0);
    merged.author_string = secondary.author_string;
  }
  if (betterVenue(secondary, merged)) {
    merged.venue = secondary.venue;
    merged.venue_short = secondary.venue_short;
    merged.venue_type = secondary.venue_type;
    if (secondary.year != null) {
      merged.year = secondary.year;
      merged.impact_per_year = impactPerYear(merged.cited_by_count, merged.year, impactYear);
    }
    if (secondary.doi && (!merged.doi || merged.doi.includes("arxiv"))) merged.doi = secondary.doi;
  }
  merged.topics = unique([...(merged.topics || []), ...(secondary.topics || [])]).slice(0, 8);
  merged.topic_ids = unique([...(merged.topic_ids || []), ...(secondary.topic_ids || [])]).slice(0, 8);
  merged.keywords = [...merged.topics];
  const combined = unique([...(left.referenced_works || []), ...(right.referenced_works || [])]);
  const capped = capRefs(combined, mustKeep);
  merged.referenced_works = capped.refs;
  merged.refs_truncated = capped.truncated;
  merged.related_works = unique([...(left.related_works || []), ...(right.related_works || [])]).slice(0, 30);
  merged.origin_tags = [...new Set([...(left.origin_tags || []), ...(right.origin_tags || [])])].sort();
  merged.alternate_ids = unique([
    ...(left.alternate_ids || []),
    ...(right.alternate_ids || []),
    left.id,
    right.id,
  ]).filter((token) => token && token !== merged.id);
  merged.cocitation_count = Math.max(left.cocitation_count || 0, right.cocitation_count || 0);
  return merged;
}

export function dedupRecords(records, mustKeep, impactYear) {
  const clusters = [];
  for (const record of records) {
    const index = clusters.findIndex((existing) => (
      record.id === existing.id
      || (existing.alternate_ids || []).includes(record.id)
      || (record.doi && record.doi === existing.doi)
      || titlesMatch(record, existing)
    ));
    if (index < 0) clusters.push(record);
    else clusters[index] = mergeRecords(clusters[index], record, mustKeep, impactYear);
  }
  return clusters;
}
