/** Classify DOI, arXiv, OpenAlex, Semantic Scholar, URL, or title. */

const DOI_RE = /(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
const ARXIV_URL_RE = /arxiv\.org\/(?:abs|pdf|html)\/([a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i;
const ARXIV_TAG_RE = /arxiv:\s*([a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?/i;
const ARXIV_DOI_RE = /10\.48550\/arxiv\.(\d{4}\.\d{4,5})/i;
const ARXIV_BARE_RE = /^\d{4}\.\d{4,5}(v\d+)?$/i;
const OPENALEX_URL_RE = /openalex\.org\/(W\d{8,})/i;
const OPENALEX_BARE_RE = /^W\d{8,}$/i;
const S2_RE = /semanticscholar\.org\/paper\/(?:[^/\s]+\/)?([a-f0-9]{20,40})/i;

function cleanDoi(doi) {
  return doi.replace(/[.,;:)>\]]+$/g, "").toLowerCase();
}

export function findDoi(text) {
  const match = DOI_RE.exec(text || "");
  return match ? cleanDoi(match[1]) : null;
}

export function findArxiv(text, { bare = false } = {}) {
  const source = text || "";
  const tagged = ARXIV_URL_RE.exec(source) || ARXIV_TAG_RE.exec(source);
  if (tagged) return tagged[1];
  const fromDoi = ARXIV_DOI_RE.exec(source);
  if (fromDoi) return fromDoi[1];
  const stripped = source.trim();
  if (bare && ARXIV_BARE_RE.test(stripped)) return stripped.replace(/v\d+$/i, "");
  return null;
}

export function findOpenAlex(text) {
  const source = text || "";
  const url = OPENALEX_URL_RE.exec(source);
  if (url) return url[1].toUpperCase();
  const stripped = source.trim();
  return OPENALEX_BARE_RE.test(stripped) ? stripped.toUpperCase() : null;
}

export function findS2(text) {
  const match = S2_RE.exec(text || "");
  return match ? match[1].toLowerCase() : null;
}

export function parseQuery(query) {
  const raw = String(query || "").trim().replace(/\s+/g, " ");
  if (!raw) return { kind: "invalid", value: "", raw };
  const doi = findDoi(raw);
  const doiExplicit = /doi\.org/i.test(raw) || /^10\./i.test(raw) || /^doi:/i.test(raw);
  if (doi && (doiExplicit || raw.length < 180)) return { kind: "doi", value: doi, raw };
  const arxiv = findArxiv(raw, { bare: true });
  if (arxiv) return { kind: "arxiv", value: arxiv, raw };
  const openalex = findOpenAlex(raw);
  if (openalex) return { kind: "openalex", value: openalex, raw };
  const s2 = findS2(raw);
  if (s2) return { kind: "s2", value: s2, raw };
  if (/^https?:\/\//i.test(raw)) return { kind: "url", value: raw, raw };
  if (doi) return { kind: "doi", value: doi, raw };
  return { kind: "title", value: raw, raw };
}
