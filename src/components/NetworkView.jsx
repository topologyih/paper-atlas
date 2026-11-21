import { useEffect, useMemo, useRef, useState } from "react";
import { networkLayout, zoomSpread } from "../lib/layout.js";
import { showNumber, showText, snippet } from "../lib/format.js";
import { colorFor } from "../lib/venues.js";
import { useChartZoom, useElementSize } from "../lib/useChartZoom.js";

function opacityFor(role) {
  if (role === "selected" || role === "related" || role === "idle") return role === "idle" ? 0.92 : 1;
  return 0.12;
}

export default function NetworkView({
  papers,
  edges,
  colorByGroup,
  selectedId,
  centerId,
  neighbors,
  onSelect,
  resetToken,
  svgRef: externalSvgRef,
}) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const worldRef = useRef(null);
  const size = useElementSize(stageRef);
  const [hover, setHover] = useState(null);
  const [dragVersion, setDragVersion] = useState(0);
  const [zoomScale, setZoomScale] = useState(1);
  useChartZoom(svgRef, worldRef, resetToken, (k) => {
    setZoomScale((current) => (Math.abs(current - k) < 0.002 ? current : k));
  });
  useEffect(() => {
    if (externalSvgRef) externalSvgRef.current = svgRef.current;
  });

  const layout = useMemo(
    () => networkLayout(papers, { width: size.width, height: size.height, centerId }),
    [papers, size.width, size.height, centerId],
  );
  const posRef = useRef(new Map());
  const layoutKey = `${centerId}:${size.width}:${size.height}:${papers.map((paper) => paper.id).join("|")}`;
  const seen = useRef("");
  if (seen.current !== layoutKey) {
    seen.current = layoutKey;
    posRef.current = new Map(layout.map((node) => [node.id, { ...node }]));
  }
  const byId = useMemo(() => new Map(papers.map((paper) => [paper.id, paper])), [papers]);
  const positions = posRef.current;
  const visibleEdges = useMemo(() => {
    const focus = selectedId && selectedId !== centerId ? selectedId : null;
    const kept = [];
    const similar = [];
    for (const edge of edges) {
      const touchCenter = edge.source === centerId || edge.target === centerId;
      const touchFocus = Boolean(focus) && (edge.source === focus || edge.target === focus);
      if (edge.type === "similarity") {
        if (touchFocus) similar.push(edge);
        continue;
      }
      if (touchCenter || touchFocus) kept.push(edge);
    }
    similar.sort((a, b) => (b.weight || 0) - (a.weight || 0));
    return kept.concat(similar.slice(0, 12));
  }, [edges, centerId, selectedId]);
  const spread = useMemo(() => {
    const nodes = [];
    for (const paper of papers) {
      const node = positions.get(paper.id);
      if (node) nodes.push(node);
    }
    return new Map(zoomSpread(nodes, zoomScale, { yearWidth: 40 }).map((node) => [node.id, node]));
  }, [papers, positions, zoomScale, dragVersion]);

  function roleOf(paper) {
    const focused = Boolean(selectedId) || neighbors.size > 0;
    if (!focused) return "idle";
    if (paper.id === selectedId) return "selected";
    if (neighbors.has(paper.id)) return "related";
    return "dim";
  }

  function onNodeDown(event, paper) {
    event.stopPropagation();
    const origin = { ...positions.get(paper.id) };
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const scale = currentScale(worldRef.current);
    const move = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 4) moved = true;
      positions.set(paper.id, { ...origin, x: origin.x + dx, y: origin.y + dy });
      setDragVersion((value) => value + 1);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) onSelect(paper);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="view-shell">
      <div className="chart-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          className="chart-svg"
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
          role="img"
          aria-label="关系图谱"
        >
          <g ref={worldRef}>
            {visibleEdges.map((edge) => {
              const source = spread.get(edge.source) || positions.get(edge.source);
              const target = spread.get(edge.target) || positions.get(edge.target);
              if (!source || !target) return null;
              const x1 = source.sx ?? source.x;
              const y1 = source.sy ?? source.y;
              const x2 = target.sx ?? target.x;
              const y2 = target.sy ?? target.y;
              const focus = selectedId && selectedId !== centerId ? selectedId : null;
              const touchFocus = Boolean(focus) && (edge.source === focus || edge.target === focus);
              const citation = edge.type === "citation";
              return (
                <line
                  key={`${edge.type}-${edge.source}-${edge.target}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={citation ? "rgba(240,211,160,0.9)" : "rgba(158,176,204,0.9)"}
                  strokeWidth={(touchFocus ? (citation ? 1.6 : 1.2) : 0.7) / Math.max(zoomScale, 0.35)}
                  strokeDasharray={citation ? undefined : "4 4"}
                  opacity={touchFocus ? 0.9 : 0.38}
                />
              );
            })}
            {papers.map((paper) => {
              const node = spread.get(paper.id) || positions.get(paper.id);
              if (!node) return null;
              const x = node.sx ?? node.x;
              const y = node.sy ?? node.y;
              const radius = node.sr ?? node.r;
              const role = roleOf(paper);
              return (
                <g
                  key={paper.id}
                  data-node="1"
                  transform={`translate(${x},${y})`}
                  onPointerDown={(event) => onNodeDown(event, paper)}
                  onPointerEnter={(event) => setHover({ paper, x: event.clientX, y: event.clientY })}
                  onPointerMove={(event) => setHover({ paper, x: event.clientX, y: event.clientY })}
                  onPointerLeave={() => setHover(null)}
                >
                  <circle r={Math.max(radius, 8 / Math.max(zoomScale, 0.35))} fill="transparent" />
                  <circle
                    r={radius}
                    fill={colorFor(paper, colorByGroup)}
                    opacity={opacityFor(role)}
                    stroke={paper.id === centerId ? "#f0d3a0" : role === "selected" ? "#fffaf3" : "rgba(8,10,14,0.5)"}
                    strokeWidth={(paper.id === centerId || role === "selected" ? 2.5 : 1) / Math.max(zoomScale, 0.35)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
        {hover && <HoverCard hover={hover} />}
      </div>
      <p className="chart-note">
        当前中心在正中。距离越近，相关度越高。圆面积表示引用数。默认只画中心的引用线。点一篇论文后，再亮出它自己的连线，虚线是相近关系。滚轮放大后，挤在一起的圆会散开。把鼠标放在圆点上查看论文名称。拖动背景平移，拖动圆点可挪开它。
        <span className="drag-token" data-version={dragVersion} />
      </p>
    </div>
  );
}

function currentScale(world) {
  const transform = world?.getAttribute("transform") || "";
  const match = /scale\(([^)]+)\)/.exec(transform);
  const scale = match ? Number(match[1]) : 1;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function HoverCard({ hover }) {
  const paper = hover.paper;
  const left = Math.min(hover.x + 16, window.innerWidth - 360);
  const top = Math.min(hover.y + 16, window.innerHeight - 240);
  return (
    <aside className="tip" style={{ left, top }}>
      <strong>{showText(paper.title)}</strong>
      <p>{showText(paper.author_string)}</p>
      <dl>
        <div><dt>年份</dt><dd>{paper.year ?? "Unknown"}</dd></div>
        <div><dt>来源</dt><dd>{showText(paper.venue)}</dd></div>
        <div><dt>引用</dt><dd>{showNumber(paper.cited_by_count)}</dd></div>
        <div><dt>相关度</dt><dd>{paper.relevance_score == null ? "Unknown" : paper.relevance_score.toFixed(2)}</dd></div>
      </dl>
      <p className="tip-abstract">{snippet(paper.abstract, 180)}</p>
    </aside>
  );
}
