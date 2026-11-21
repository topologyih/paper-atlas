/** Text helpers. Keep the tokenizer aligned with server/paperatlas/textutil.py. */

export const STOPWORDS = new Set([
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
]);

const TOKEN_RE = /[a-z0-9]+|[\u4e00-\u9fff]+/gi;
const BAD_TITLE_RE = /^(front matter|back matter|editorial board|table of contents|title page|contents|index)$/i;

export const VENUE_RANK = {
  conference: 0,
  journal: 0,
  "book series": 1,
  "ebook platform": 2,
  repository: 3,
  unknown: 4,
};

export function shortId(value) {
  if (!value) return null;
  const token = String(value).replace(/\/+$/, "").split("/").pop().trim();
  return token || null;
}

export function bareDoi(value) {
  if (!value) return null;
  let doi = String(value).trim();
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  doi = doi.replace(/^doi:\s*/i, "");
  doi = doi.replace(/[.,;:)>\]]+$/g, "").toLowerCase();
  return doi || null;
}

export function reconstructAbstract(value) {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  const pairs = [];
  for (const [word, locs] of Object.entries(value)) {
    if (!Array.isArray(locs)) continue;
    for (const loc of locs) {
      if (Number.isInteger(loc)) pairs.push([loc, String(word)]);
    }
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  const text = pairs.map((pair) => pair[1]).join(" ").trim();
  return text || null;
}

export function titleKey(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(title, abstract) {
  const source = `${title || ""} ${title || ""} ${String(abstract || "").slice(0, 500)}`.toLowerCase();
  const counts = {};
  for (const match of source.matchAll(TOKEN_RE)) {
    const token = match[0];
    const code = token.codePointAt(0);
    const cjk = code >= 0x4e00 && code <= 0x9fff;
    const grams = cjk
      ? (token.length === 1 ? [token] : Array.from({ length: token.length - 1 }, (_, i) => token.slice(i, i + 2)))
      : [token];
    for (const gram of grams) {
      if (STOPWORDS.has(gram) || gram.length < 2) continue;
      counts[gram] = (counts[gram] || 0) + 1;
    }
  }
  return counts;
}

export function cosine(left, right) {
  if (!left || !right) return 0;
  let dot = 0;
  for (const [key, value] of Object.entries(left)) {
    if (right[key]) dot += value * right[key];
  }
  if (dot <= 0) return 0;
  const norm = (bag) => Math.sqrt(Object.values(bag).reduce((sum, value) => sum + value * value, 0));
  const leftNorm = norm(left);
  const rightNorm = norm(right);
  if (!leftNorm || !rightNorm) return 0;
  return dot / (leftNorm * rightNorm);
}

export function jaccard(left, right) {
  const a = new Set(left || []);
  const b = new Set(right || []);
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const value of a) if (b.has(value)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function cleanVenue(name) {
  if (!name || !String(name).trim()) return "Unknown";
  let text = String(name).replace(/<[^>]+>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  if (text.toLowerCase().includes("arxiv")) return "arXiv";
  if ((text.match(/\//g) || []).length >= 1 && text.length > 80) {
    const parts = text.split(/\s*\/\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length) text = parts.sort((a, b) => a.length - b.length)[0];
  }
  text = text.split(" - ")[0].trim();
  text = text.replace(/^proceedings of (the )?/i, "").trim();
  text = text.replace(/\s+/g, " ").replace(/^[\s,./-]+|[\s,./-]+$/g, "");
  return text || "Unknown";
}

export function shortVenue(name) {
  if (!name || name === "Unknown") return "Unknown";
  if (name === "arXiv") return "arXiv";
  const match = name.match(/\(([A-Z][A-Za-z0-9.&/+-]{2,18})\)\s*$/);
  if (match) return match[1];
  if (name.length > 36) return `${name.slice(0, 34).trimEnd()}…`;
  return name;
}

export function isBadTitle(title) {
  if (!title || !String(title).trim()) return true;
  return BAD_TITLE_RE.test(String(title).trim());
}

export function capRefs(refs, mustKeep, limit = 200) {
  const unique = [];
  const seen = new Set();
  for (const ref of refs || []) {
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      unique.push(ref);
    }
  }
  if (unique.length <= limit) return { refs: unique, truncated: false };
  const keep = mustKeep || new Set();
  const head = unique.filter((ref) => keep.has(ref));
  const tail = unique.filter((ref) => !keep.has(ref));
  return { refs: [...head, ...tail].slice(0, limit), truncated: true };
}

function locationName(location) {
  const source = location?.source || {};
  return {
    cleaned: cleanVenue(source.display_name || location?.raw_source_name || ""),
    venueType: String(source.type || "unknown").toLowerCase(),
  };
}

export function venueFromWork(work) {
  const candidates = [];
  if (work?.primary_location) candidates.push(work.primary_location);
  for (const location of work?.locations || []) candidates.push(location);
  let best = null;
  let bestKey = null;
  for (const location of candidates) {
    if (!location) continue;
    let { cleaned, venueType } = locationName(location);
    let rank = VENUE_RANK[venueType] ?? 4;
    if (cleaned === "arXiv") {
      rank = Math.max(rank, 3);
      venueType = "repository";
    }
    const key = [rank, location.is_published ? 0 : 1, cleaned === "Unknown" ? 1 : 0];
    if (!best || key.join() < bestKey.join()) {
      best = { venue: cleaned, venue_short: shortVenue(cleaned), venue_type: venueType };
      bestKey = key;
    }
  }
  return best || { venue: "Unknown", venue_short: "Unknown", venue_type: "unknown" };
}

export function authorsFromWork(work, limit = 20) {
  const names = [];
  for (const authorship of work?.authorships || []) {
    const name = String(authorship?.author?.display_name || authorship?.raw_author_name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (name && !names.includes(name)) names.push(name);
  }
  const total = (work?.authorships || []).length || names.length;
  if (!names.length) return { authors: [], author_count: total, author_string: "Unknown" };
  const shown = names.slice(0, limit);
  return {
    authors: shown,
    author_count: total,
    author_string: total > shown.length ? `${shown.join(", ")} et al.` : shown.join(", "),
  };
}

export function extractArxiv(work, doi, oaUrl, landing) {
  const raw = work?.ids?.arxiv;
  if (raw) return String(raw).replace(/\/+$/, "").split("/").pop().replace(/v\d+$/i, "");
  const blob = [doi, oaUrl, landing].filter(Boolean).join(" ");
  const urlMatch = blob.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5})/i);
  if (urlMatch) return urlMatch[1];
  const doiMatch = blob.match(/10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i);
  return doiMatch ? doiMatch[1] : null;
}

export function pdfUrls(work) {
  const primary = work?.primary_location || {};
  const locations = [primary, ...(work?.locations || [])];
  let pdf = null;
  let landing = primary.landing_page_url || null;
  const oaUrl = work?.open_access?.oa_url || null;
  for (const location of locations) {
    if (!location) continue;
    if (!landing && location.landing_page_url) landing = location.landing_page_url;
    if (!pdf && location.pdf_url) pdf = location.pdf_url;
  }
  if (!pdf && oaUrl && (/\/pdf/i.test(oaUrl) || oaUrl.toLowerCase().endsWith(".pdf"))) pdf = oaUrl;
  return { oa_url: oaUrl, pdf_url: pdf, landing_url: landing };
}
