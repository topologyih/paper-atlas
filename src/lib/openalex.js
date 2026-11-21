/** Browser OpenAlex client. Responses are cached for the session and retried on 429. */

const SELECT = [
  "id", "doi", "display_name", "publication_year", "publication_date", "type",
  "cited_by_count", "is_retracted", "ids", "open_access", "primary_location",
  "locations", "topics", "authorships", "referenced_works", "related_works",
  "abstract_inverted_index",
].join(",");

export { SELECT };

export class ApiError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.status = extra.status ?? null;
    this.body = extra.body || "";
    this.candidates = extra.candidates || null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createOpenAlex() {
  const memory = new Map();
  const stats = { calls: 0, cacheHits: 0 };
  let lastAt = 0;
  const env = import.meta.env || {};

  function buildUrl(path, params) {
    const url = path.startsWith("http") ? new URL(path) : new URL(path, "https://api.openalex.org");
    const entries = Object.entries(params || {}).filter(([, value]) => value != null);
    entries.sort(([a], [b]) => a.localeCompare(b));
    for (const [key, value] of entries) url.searchParams.set(key, String(value));
    if (env.VITE_OPENALEX_API_KEY) url.searchParams.set("api_key", env.VITE_OPENALEX_API_KEY);
    if (env.VITE_OPENALEX_MAILTO) url.searchParams.set("mailto", env.VITE_OPENALEX_MAILTO);
    return url.toString();
  }

  async function get(path, params = {}, { signal, attempt = 0 } = {}) {
    const url = buildUrl(path, params);
    if (memory.has(url)) {
      stats.cacheHits += 1;
      return memory.get(url);
    }
    const wait = 250 - (Date.now() - lastAt);
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    let response;
    try {
      response = await fetch(url, { headers: { Accept: "application/json" }, signal });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (attempt < 3) {
        await sleep(600 * (attempt + 1));
        return get(path, params, { signal, attempt: attempt + 1 });
      }
      throw new ApiError("无法连接 OpenAlex。可以先看内置示例，或检查网络。");
    }
    stats.calls += 1;
    if (response.status === 429 || response.status >= 500) {
      const body = await response.text();
      if (/search temporarily unavailable|anonymous search is paused/i.test(body)) {
        throw new ApiError("OpenAlex 标题检索暂不可用。将改用 Crossref 和 Semantic Scholar。", { status: response.status, body });
      }
      if (response.status === 429 && /insufficient budget/i.test(body)) {
        throw new ApiError(
          "OpenAlex 今日额度已用完。匿名额度按 IP 共享，大约每天 0.10 美元。可配置 VITE_OPENALEX_API_KEY，或先使用内置示例。",
          { status: response.status, body },
        );
      }
      if (attempt < 4) {
        const retry = Number(response.headers.get("retry-after")) || 2 ** attempt;
        await sleep(Math.min(Math.max(retry, 0.5), 20) * 1000);
        return get(path, params, { signal, attempt: attempt + 1 });
      }
      const budget = /budget|credit|rate/i.test(body);
      throw new ApiError(
        budget
          ? "OpenAlex 额度已用完。匿名额度按 IP 共享，大约每天 0.10 美元。可配置 VITE_OPENALEX_API_KEY，或先使用内置示例。"
          : `OpenAlex 请求失败（${response.status}）。`,
        { status: response.status, body },
      );
    }
    if (!response.ok) {
      const body = await response.text();
      throw new ApiError(`OpenAlex HTTP ${response.status}`, { status: response.status, body });
    }
    const data = await response.json();
    memory.set(url, data);
    return data;
  }

  return { get, stats, select: SELECT };
}

export async function serverAvailable() {
  const base = import.meta.env?.VITE_API_BASE ?? "";
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}
