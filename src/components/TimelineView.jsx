import { useEffect, useMemo, useRef, useState } from "react";
import { aggregateByYearVenue, timelineLayout, yearAxisTicks, zoomSpread } from "../lib/layout.js";
import { impactValue } from "../lib/filter.js";
import { showNumber, showText, snippet } from "../lib/format.js";
import { colorFor } from "../lib/venues.js";
import { useChartZoom, useElementSize } from "../lib/useChartZoom.js";

function roleOf(paper, selected, neighbors) {
  if (!selected) return "idle";
  if (paper.id === selected.id) return "selected";
  if (neighbors.has(paper.id)) return "related";
  if (paper.venue_group && paper.venue_group === selected.venue_group) return "venue";
  if (paper.year != null && paper.year === selected.year) return "year";
  return "dim";
}

function opacityFor(role) {
  if (role === "dim") return 0.14;
  if (role === "year") return 0.5;
  if (role === "venue") return 0.82;
  return 0.96;
}

export default function TimelineView({
  papers,
  colorByGroup,
  impactMode,
  layoutMode,
  aggregate,
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
  const [zoomScale, setZoomScale] = useState(1);
  useChartZoom(svgRef, worldRef, resetToken, (k) => {
    setZoomScale((current) => (Math.abs(current - k) < 0.002 ? current : k));
  });
  useEffect(() => {
    if (externalSvgRef) externalSvgRef.current = svgRef.current;
  });

  const dated = papers.filter((paper) => Number.isFinite(paper.year));
  const undated = papers.filter((paper) => !Number.isFinite(paper.year));
  const plotted = aggregate ? aggregateByYearVenue(dated, impactMode) : dated;
  const impactOf = (paper) => impactValue(paper, impactMode) || 0;
  const layout = useMemo(
    () => timelineLayout(plotted, { width: size.width, height: size.height, mode: layoutMode, impactOf }),
    [plotted, size.width, size.height, layoutMode, impactMode],
  );
  const byId = useMemo(() => new Map(plotted.map((paper) => [paper.id, paper])), [plotted]);
  const selected = plotted.find((paper) => paper.id === selectedId)
    || plotted.find((paper) => paper.members?.some((member) => member.id === selectedId));
  const years = [];
  for (let year = layout.minYear; year <= layout.maxYear; year += 1) years.push(year);
  const yearSpacing = years.length > 1 ? layout.xPix(layout.minYear + 1) - layout.xPix(layout.minYear) : 40;
  const labelYears = yearAxisTicks(layout.minYear, layout.maxYear, layout.xPix);
  const gridYears = yearSpacing >= 8 ? years : labelYears;
  const drawn = useMemo(
    () => new Map(zoomSpread(layout.nodes, zoomScale, { yearWidth: yearSpacing }).map((node) => [node.id, node])),
    [layout, zoomScale, yearSpacing],
  );
  const yTicks = [];
  if (layout.mode === "impact" && layout.yPix) {
    for (let exp = Math.ceil(layout.y0); exp <= Math.floor(layout.y1); exp += 1) yTicks.push(exp);
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
          aria-label="时间影响力图"
        >
          <g ref={worldRef}>
            {gridYears.map((year) => (
              <line
                key={`grid-${year}`}
                x1={layout.xPix(year)}
                x2={layout.xPix(year)}
                y1={layout.pad.t}
                y2={size.height - layout.pad.b}
                stroke={selected?.year === year ? "rgba(228,160,74,0.55)" : "rgba(239,234,226,0.08)"}
              />
            ))}
            {selected?.year != null && !gridYears.includes(selected.year) && (
              <line
                x1={layout.xPix(selected.year)}
                x2={layout.xPix(selected.year)}
                y1={layout.pad.t}
                y2={size.height - layout.pad.b}
                stroke="rgba(228,160,74,0.55)"
              />
            )}
            {labelYears.map((year) => (
              <text
                key={`label-${year}`}
                x={layout.xPix(year)}
                y={size.height - 18}
                textAnchor="middle"
                className={selected?.year === year ? "axis-label axis-label-on" : "axis-label"}
              >
                {year}
              </text>
            ))}
            {layout.mode === "impact" && yTicks.map((exp) => (
              <g key={exp}>
                <line
                  x1={layout.pad.l}
                  x2={size.width - layout.pad.r}
                  y1={layout.yPix(exp)}
                  y2={layout.yPix(exp)}
                  stroke="rgba(239,234,226,0.06)"
                />
                <text x={12} y={layout.yPix(exp) + 4} className="axis-label">
                  {showNumber(10 ** exp)}
                </text>
              </g>
            ))}
            {layout.nodes.map((node) => {
              const paper = byId.get(node.id);
              if (!paper) return null;
              const role = roleOf(paper, selected, neighbors);
              const fill = colorFor(paper, colorByGroup);
              const draw = drawn.get(node.id) || node;
              const x = draw.sx ?? node.x;
              const y = draw.sy ?? node.y;
              const radius = draw.sr ?? node.r;
              return (
                <g
                  key={paper.id}
                  data-node="1"
                  data-id={paper.id}
                  transform={`translate(${x},${y})`}
                  onPointerEnter={(event) => setHover({ paper, x: event.clientX, y: event.clientY })}
                  onPointerMove={(event) => setHover({ paper, x: event.clientX, y: event.clientY })}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => onSelect(paper)}
                >
                  <circle r={Math.max(radius, 12 / Math.max(zoomScale, 0.35))} fill="transparent" />
                  <circle
                    r={radius}
                    fill={fill}
                    opacity={opacityFor(role)}
                    stroke={paper.id === centerId ? "#f0d3a0" : role === "selected" ? "#fffaf3" : "rgba(8,10,14,0.45)"}
                    strokeWidth={(paper.id === centerId || role === "selected" ? 2.4 : 1) / Math.max(zoomScale, 0.35)}
                  />
                </g>
              );
            })}
          </g>
        </svg>
        {hover && <HoverCard hover={hover} impactMode={impactMode} />}
      </div>
      <p className="chart-note">
        {layoutMode === "beeswarm"
          ? "横轴是发表年份。纵轴只用来避免重叠，不表示数值。圆面积按影响力的平方根缩放。滚轮放大后，挤在一起的圆会散开。把鼠标放在圆点上查看论文名称。"
          : "横轴是发表年份。纵轴是影响力的对数。圆面积按影响力的平方根缩放。同一年的圆只会在该年范围内错开。滚轮放大后，挤在一起的圆会散开。把鼠标放在圆点上查看论文名称。"}
        {undated.length > 0 && ` 另有 ${undated.length} 篇年份为 Unknown，没有画在时间轴上。`}
      </p>
    </div>
  );
}

function HoverCard({ hover, impactMode }) {
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
        <div><dt>{impactMode === "per_year" ? "年均引用" : "DOI"}</dt><dd>{impactMode === "per_year" ? showNumber(paper.impact_per_year) : showText(paper.doi)}</dd></div>
      </dl>
      <p className="tip-abstract">{paper.isAggregate ? `${paper.members.length} 篇论文，点击查看列表。` : snippet(paper.abstract, 180)}</p>
    </aside>
  );
}
