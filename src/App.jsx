import { useEffect, useMemo, useRef, useState } from "react";
import DataNotes from "./components/DataNotes.jsx";
import DetailPanel from "./components/DetailPanel.jsx";
import FilterBar from "./components/FilterBar.jsx";
import NetworkView from "./components/NetworkView.jsx";
import TimelineView from "./components/TimelineView.jsx";
import { buildGraph, expandAround, loadThroughServer } from "./lib/expand.js";
import { downloadCsv, downloadPng, downloadSvg } from "./lib/export.js";
import { applyFilters, neighborIds, topTopics } from "./lib/filter.js";
import { ApiError, serverAvailable } from "./lib/openalex.js";
import { extractPdfQuery } from "./lib/pdfExtract.js";
import { buildEdges, rescorePapers } from "./lib/score.js";
import { assignVenueGroups } from "./lib/venues.js";

const LIMITS = [50, 100, 200, 300, 500];
const CACHE_KEY = "paper-atlas-graph-v1";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

function yearBounds(papers) {
  const years = papers.map((paper) => paper.year).filter((year) => Number.isFinite(year));
  const dataYearMin = years.length ? Math.min(...years) : 1990;
  const dataYearMax = years.length ? Math.max(...years) : new Date().getFullYear();
  return { dataYearMin, dataYearMax, yearMin: dataYearMin, yearMax: dataYearMax };
}

function freshFilters(papers, centerId) {
  return {
    keyword: "",
    topics: [],
    hiddenVenues: [],
    impactMode: "citations",
    minImpact: 0,
    topN: 0,
    centerId,
    ...yearBounds(papers),
  };
}

function centerOf(graph) {
  return graph?.meta?.center_id || graph?.meta?.seed_id || graph?.papers?.find((paper) => paper.is_seed)?.id || null;
}

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const limit = Number(params.get("n"));
  return {
    q: params.get("q") || "",
    n: LIMITS.includes(limit) ? limit : 100,
  };
}

function writeHash(query, limit) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (limit) params.set("n", String(limit));
  const next = params.toString();
  const url = `${window.location.pathname}${window.location.search}${next ? `#${next}` : ""}`;
  window.history.replaceState(null, "", url);
}

function readCache() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(CACHE_KEY) || "null");
    if (!saved?.graph?.papers?.length || !saved.savedAt) return null;
    if (Date.now() - saved.savedAt > CACHE_MS) return null;
    return saved;
  } catch {
    return null;
  }
}

function writeCache(query, limit, graph) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), query, limit, graph }));
  } catch {
    /* The graph can exceed the browser storage quota. The page still works. */
  }
}

async function loadSample() {
  const response = await fetch(`${import.meta.env.BASE_URL}sample.json`);
  if (!response.ok) throw new Error("内置示例没有加载");
  return response.json();
}

async function readPdf(file) {
  let browserError = null;
  try {
    const found = await extractPdfQuery(file);
    if (found?.kind && found.kind !== "invalid") return found;
  } catch (error) {
    browserError = error;
  }
  if (await serverAvailable()) {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/pdf", { method: "POST", body });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.detail || "PDF 解析失败");
    if (payload.kind && payload.kind !== "invalid") return payload;
  }
  throw browserError || new Error("没有从 PDF 里识别出 DOI、arXiv 或标题");
}

export default function App() {
  const [graph, setGraph] = useState(null);
  const [query, setQuery] = useState("10.48550/arXiv.1706.03762");
  const [limit, setLimit] = useState(100);
  const [view, setView] = useState("timeline");
  const [filters, setFilters] = useState(null);
  const [centerId, setCenterId] = useState(null);
  const [selection, setSelection] = useState(null);
  const [layoutMode, setLayoutMode] = useState("impact");
  const [aggregate, setAggregate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [resetToken, setResetToken] = useState(0);
  const timelineSvg = useRef(null);
  const networkSvg = useRef(null);
  const abortRef = useRef(null);

  function showGraph(next, nextCenter = centerOf(next)) {
    setGraph(next);
    setCenterId(nextCenter);
    setFilters(freshFilters(next.papers, nextCenter));
    setSelection(next.papers.find((paper) => paper.id === nextCenter) || null);
    setResetToken((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sample = await loadSample();
        if (cancelled) return;
        const hash = readHash();
        const cached = readCache();
        setQuery(hash.q || sample.meta.seed_query || "");
        setLimit(hash.n);
        if (cached && hash.q && cached.query === hash.q && cached.limit === hash.n) {
          showGraph(cached.graph);
          setNotice("已恢复这个链接在本机保存的图谱。");
          return;
        }
        showGraph(sample);
        if (hash.q && hash.q !== sample.meta.seed_query && hash.q !== sample.meta.parsed_value) {
          setNotice("地址里的查询还没有抓取。当前显示内置示例。点击生成图谱后再请求数据源。");
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "示例加载失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const decorated = useMemo(
    () => assignVenueGroups(graph?.papers || []),
    [graph],
  );
  const topics = useMemo(() => topTopics(decorated.papers, 12), [decorated]);
  const filtered = useMemo(
    () => (filters ? applyFilters(decorated.papers, filters) : { papers: [], centerOutside: false, matchedCount: 0 }),
    [decorated, filters],
  );
  const legend = useMemo(() => {
    if (!filters) return [];
    const pool = applyFilters(decorated.papers, { ...filters, skipVenue: true, skipTopN: true }).papers;
    const counts = new Map();
    for (const paper of pool) {
      const group = paper.venue_group || "Unknown";
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [decorated, filters]);
  const byId = useMemo(() => new Map(decorated.papers.map((paper) => [paper.id, paper])), [decorated]);
  const visibleIds = useMemo(() => new Set(filtered.papers.map((paper) => paper.id)), [filtered]);
  const visibleEdges = useMemo(() => {
    return (graph?.edges || []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
  }, [graph, visibleIds]);

  const selectedPaper = useMemo(() => {
    if (!selection) return null;
    if (selection.isAggregate) {
      const members = (selection.members || []).map((member) => byId.get(member.id) || member).filter((member) => visibleIds.has(member.id));
      if (!members.length) return null;
      return { ...selection, members };
    }
    if (!visibleIds.has(selection.id)) return null;
    return byId.get(selection.id) || null;
  }, [selection, byId, visibleIds]);

  const neighbors = useMemo(() => {
    if (!selectedPaper) return new Set();
    if (selectedPaper.isAggregate) {
      const ids = new Set(selectedPaper.members.map((member) => member.id));
      for (const member of selectedPaper.members) {
        for (const id of neighborIds(graph?.edges || [], member.id)) ids.add(id);
      }
      return ids;
    }
    return neighborIds(graph?.edges || [], selectedPaper.id);
  }, [selectedPaper, graph]);

  async function generate(rawQuery = query, rawLimit = limit) {
    const text = String(rawQuery || "").trim();
    if (!text) {
      setError("请输入 DOI、arXiv、标题或论文 URL");
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setCandidates(null);
    setProgress("正在连接数据源");
    setQuery(text);
    try {
      let next;
      if (await serverAvailable()) {
        setProgress("通过本地服务抓取");
        next = await loadThroughServer(text, rawLimit);
      } else {
        next = await buildGraph(text, {
          limit: rawLimit,
          signal: controller.signal,
          onProgress: (step) => setProgress(step.message || ""),
        });
      }
      if (controller.signal.aborted) return;
      showGraph(next);
      writeHash(text, rawLimit);
      writeCache(text, rawLimit, next);
      setNotice("");
      setView("timeline");
    } catch (err) {
      if (controller.signal.aborted) return;
      if (err instanceof ApiError && err.candidates?.length) {
        setCandidates(err.candidates);
        setError(err.message);
      } else {
        setError(err.message || "图谱没有生成");
      }
    } finally {
      if (abortRef.current === controller) {
        setBusy(false);
        setProgress("");
      }
    }
  }

  async function onPdf(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setProgress("正在读取 PDF");
    try {
      const found = await readPdf(file);
      const text = found.value || found.raw || "";
      setQuery(text);
      setNotice(`从 PDF 识别为${found.kind === "title" ? "标题" : found.kind}：${text}`);
      setBusy(false);
      await generate(text, limit);
    } catch (err) {
      setError(err.message || "PDF 解析失败");
      setBusy(false);
      setProgress("");
    }
  }

  function onCenter(paper) {
    if (!paper?.id || !graph) return;
    const papers = rescorePapers(graph.papers, paper.id);
    const edges = buildEdges(papers, paper.id);
    const next = {
      ...graph,
      papers,
      edges,
      meta: { ...graph.meta, center_id: paper.id, edge_count: edges.length },
    };
    setGraph(next);
    setCenterId(paper.id);
    setFilters((current) => ({ ...(current || freshFilters(papers, paper.id)), centerId: paper.id }));
    setSelection(papers.find((item) => item.id === paper.id) || paper);
    setView("network");
  }

  async function onExpand(paper) {
    if (!paper?.id || !graph) return;
    setBusy(true);
    setError("");
    setProgress("正在扩展这篇论文");
    try {
      const next = await expandAround(graph, paper.id, {
        onProgress: (step) => setProgress(step.message || ""),
      });
      const nextCenter = centerOf(next);
      showGraph(next, nextCenter);
      writeCache(query, limit, next);
      setNotice(next.meta.warnings?.at(-1) || "");
    } catch (err) {
      setError(err.message || "扩展失败");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function restoreSample() {
    setError("");
    setNotice("");
    setCandidates(null);
    try {
      const sample = await loadSample();
      setQuery(sample.meta.seed_query || "");
      showGraph(sample);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    } catch (err) {
      setError(err.message || "示例没有打开");
    }
  }

  function resetFilters() {
    if (!graph) return;
    setFilters(freshFilters(decorated.papers, centerId));
  }

  function exportSvg() {
    const svg = view === "timeline" ? timelineSvg.current : networkSvg.current;
    if (svg) downloadSvg(svg, view === "timeline" ? "paper-atlas-timeline.svg" : "paper-atlas-network.svg");
  }

  function exportPng() {
    const svg = view === "timeline" ? timelineSvg.current : networkSvg.current;
    if (svg) downloadPng(svg, view === "timeline" ? "paper-atlas-timeline.png" : "paper-atlas-network.png");
  }

  if (loadError) {
    return <p className="boot-error">示例数据没有打开：{loadError}</p>;
  }
  if (!graph || !filters) {
    return <p className="boot">正在打开内置示例…</p>;
  }

  const seed = byId.get(graph.meta.seed_id) || graph.papers.find((paper) => paper.is_seed);
  const warning = graph.meta.warnings?.[0];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="mark">论文星图</p>
          <p className="sub">一篇论文的时间影响力与引用邻域</p>
        </div>
        <form className="query-form" onSubmit={(event) => { event.preventDefault(); generate(); }}>
          <label className="query-label">
            <span>DOI、arXiv、标题或论文 URL</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如 10.48550/arXiv.1706.03762"
              disabled={busy}
            />
          </label>
          <label className="limit-label">
            <span>规模</span>
            <select value={limit} onChange={(event) => setLimit(Number(event.target.value))} disabled={busy}>
              {LIMITS.map((count) => <option key={count} value={count}>{count} 篇</option>)}
            </select>
          </label>
          <button type="submit" className="primary" disabled={busy}>{busy ? (progress || "正在生成") : "生成图谱"}</button>
          <label className="pdf-button">
            上传 PDF
            <input type="file" accept="application/pdf,.pdf" onChange={onPdf} disabled={busy} />
          </label>
        </form>
        <div className="top-actions">
          <button type="button" onClick={restoreSample} disabled={busy}>内置示例</button>
          <button type="button" onClick={() => setNotesOpen(true)}>数据说明</button>
        </div>
      </header>

      {(warning || notice || error) && (
        <div className="banners">
          {error && <p className="banner error">{error}</p>}
          {notice && <p className="banner">{notice}</p>}
          {warning && <p className="banner warn">{warning}</p>}
        </div>
      )}

      <div className={`workspace${selectedPaper ? " with-detail" : ""}`}>
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          topics={topics}
          legend={legend}
          colorByGroup={decorated.colorByGroup}
          onReset={resetFilters}
          layoutMode={layoutMode}
          setLayoutMode={setLayoutMode}
          aggregate={aggregate}
          setAggregate={(value) => {
            setAggregate(value);
            if (!value) setSelection((current) => (current?.isAggregate ? null : current));
          }}
          view={view}
          resultCount={filtered.papers.length}
        />
        <main className="stage">
          <div className="stage-bar">
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "on" : ""} onClick={() => setView("timeline")}>时间影响力</button>
              <button type="button" role="tab" aria-selected={view === "network"} className={view === "network" ? "on" : ""} onClick={() => setView("network")}>引用网络</button>
            </div>
            <p className="seed-line">
              种子 {seed?.title || graph.meta.seed_title || "Unknown"}
              <span> · {graph.meta.origin === "sample" ? "内置示例" : graph.meta.origin === "server" ? "本地服务" : "即时抓取"} · {graph.meta.paper_count ?? graph.papers.length} 篇</span>
              {filtered.centerOutside && <span> · 中心论文在当前筛选之外，仍保留在图中</span>}
            </p>
            <div className="export-row">
              <button type="button" onClick={() => setResetToken((value) => value + 1)}>重置缩放</button>
              <button type="button" onClick={() => downloadCsv(filtered.papers)}>导出 CSV</button>
              <button type="button" onClick={exportSvg}>导出 SVG</button>
              <button type="button" onClick={exportPng}>导出 PNG</button>
            </div>
          </div>
          {view === "timeline" ? (
            <TimelineView
              papers={filtered.papers}
              colorByGroup={decorated.colorByGroup}
              impactMode={filters.impactMode}
              layoutMode={layoutMode}
              aggregate={aggregate}
              selectedId={selectedPaper?.id || null}
              centerId={centerId}
              neighbors={neighbors}
              onSelect={setSelection}
              resetToken={resetToken}
              svgRef={timelineSvg}
            />
          ) : (
            <NetworkView
              papers={filtered.papers}
              edges={visibleEdges}
              colorByGroup={decorated.colorByGroup}
              selectedId={selectedPaper?.isAggregate ? null : selectedPaper?.id || null}
              centerId={centerId}
              neighbors={neighbors}
              onSelect={setSelection}
              resetToken={resetToken}
              svgRef={networkSvg}
            />
          )}
        </main>
        {selectedPaper && (
          <DetailPanel
            paper={selectedPaper}
            busy={busy}
            onClose={() => setSelection(null)}
            onCenter={onCenter}
            onExpand={onExpand}
          />
        )}
      </div>

      {notesOpen && <DataNotes meta={graph.meta} onClose={() => setNotesOpen(false)} />}
      {candidates && (
        <div className="modal-back" onClick={() => setCandidates(null)}>
          <section className="modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>找到多篇可能的论文</h2>
              <button type="button" className="text-button" onClick={() => setCandidates(null)}>关闭</button>
            </header>
            <ul className="member-list">
              {candidates.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => generate(item.id, limit)}>
                    <strong>{item.title}</strong>
                    <span>{item.year ?? "Unknown"} · {item.cited_by_count ?? "Unknown"} 次引用{item.authors?.length ? ` · ${item.authors.join(", ")}` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
