/** Pixel layouts for the timeline and the radial citation map. */

function hash(id) {
  let value = 0;
  for (const char of String(id)) value = (value * 33 + char.charCodeAt(0)) >>> 0;
  return value;
}

/** Year labels that stay at least `minGap` pixels apart. End years replace a nearby round tick. */
export function yearAxisTicks(minYear, maxYear, xPix, minGap = 58) {
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear) || maxYear < minYear) return [];
  if (minYear === maxYear) return [minYear];
  const span = maxYear - minYear;
  const plotWidth = Math.abs(xPix(maxYear) - xPix(minYear));
  const capacity = Math.max(2, Math.floor(Math.max(plotWidth, minGap) / minGap));
  const rough = span / Math.max(1, capacity - 1);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rough - 1e-9)
    || magnitude * 10;
  const ticks = [];
  for (let year = Math.ceil(minYear / step) * step; year <= maxYear; year += step) ticks.push(year);

  const placed = [];
  const add = (year, replaceNeighbor) => {
    const clash = placed.findIndex((other) => Math.abs(xPix(other) - xPix(year)) < minGap);
    if (clash === -1) placed.push(year);
    else if (replaceNeighbor) placed[clash] = year;
  };
  for (const year of ticks) add(year, false);
  add(minYear, true);
  add(maxYear, true);
  return [...new Set(placed)].sort((a, b) => a - b);
}

function labelWidth(text) {
  let width = 0;
  for (const char of String(text)) width += char.charCodeAt(0) > 255 ? 11 : 6.3;
  return width;
}

function labelBox(x, y, anchor, width) {
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return { x: left, y: y - 12, x2: left + width, y2: y + 3 };
}

function boxesOverlap(a, b, pad = 5) {
  return a.x < b.x2 + pad && a.x2 + pad > b.x && a.y < b.y2 + pad && a.y2 + pad > b.y;
}

/** Keep the largest titles that fit. A title is omitted when every nearby slot overlaps another title. */
export function placeNodeLabels(nodes, titles, { maxLabels = 6, priorityIds = [], bounds = null } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const order = [];
  const seen = new Set();
  for (const id of priorityIds) {
    if (byId.has(id) && !seen.has(id)) {
      order.push(byId.get(id));
      seen.add(id);
    }
  }
  const rest = [...nodes].filter((node) => !seen.has(node.id)).sort((a, b) => b.r - a.r);
  for (const node of rest) order.push(node);

  const occupied = [];
  const labels = [];
  for (const node of order) {
    const priority = priorityIds.includes(node.id);
    if (!priority && labels.length >= maxLabels) continue;
    const text = titles.get(node.id);
    if (!text) continue;
    const width = labelWidth(text);
    const gap = 7;
    const radius = node.r || 8;
    const spots = [
      [node.x, node.y - radius - gap, "middle"],
      [node.x + radius + gap, node.y + 4, "start"],
      [node.x - radius - gap, node.y + 4, "end"],
      [node.x, node.y + radius + 16, "middle"],
      [node.x + radius + gap, node.y - radius, "start"],
      [node.x - radius - gap, node.y - radius, "end"],
      [node.x, node.y - radius - 24, "middle"],
      [node.x + radius + gap, node.y + radius + 4, "start"],
      [node.x - radius - gap, node.y + radius + 4, "end"],
    ];
    let chosen = null;
    for (const [x, y, anchor] of spots) {
      const box = labelBox(x, y, anchor, width);
      if (bounds && (box.x < bounds.x || box.x2 > bounds.x2 || box.y < bounds.y || box.y2 > bounds.y2)) continue;
      if (occupied.some((other) => boxesOverlap(box, other))) continue;
      chosen = { x, y, anchor, box };
      break;
    }
    if (!chosen) continue;
    occupied.push(chosen.box);
    const offset = Math.hypot(chosen.x - node.x, chosen.y - node.y);
    labels.push({
      id: node.id,
      x: chosen.x,
      y: chosen.y,
      anchor: chosen.anchor,
      text,
      leader: offset > radius + 18,
      box: chosen.box,
    });
  }
  return labels;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Zoomed-in circles keep a slower radius and are pushed apart from their anchors.
 * At 1× the layout is unchanged. Spread is in the same coordinates as the zoom group.
 */
export function zoomSpread(nodes, k, { yearWidth = 28 } = {}) {
  const scale = Math.max(Number(k) || 1, 0.35);
  const open = clamp((scale - 1) / 1.7, 0, 1);
  if (open === 0) {
    return nodes.map((node) => ({ ...node, sx: node.x, sy: node.y, sr: node.r }));
  }
  const placed = nodes.map((node) => ({
    ...node,
    sx: node.x,
    sy: node.y,
    sr: node.r * scale ** -0.45,
  }));
  const maxX = Math.max(yearWidth * 0.55, 34) * open;
  const maxY = (20 + 110 * open);
  const iterations = 6 + Math.round(open * 14);
  for (let iter = 0; iter < iterations; iter += 1) {
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i];
        const b = placed[j];
        let dx = b.sx - a.sx;
        let dy = b.sy - a.sy;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = (a.sr + b.sr) * (0.2 + 0.95 * open);
        if (dist >= min) continue;
        const push = ((min - dist) / 2) * 0.85;
        dx /= dist;
        dy /= dist;
        a.sx -= dx * push;
        a.sy -= dy * push;
        b.sx += dx * push;
        b.sy += dy * push;
      }
    }
    for (const node of placed) {
      node.sx = clamp(node.sx, node.x - maxX, node.x + maxX);
      node.sy = clamp(node.sy, node.y - maxY, node.y + maxY);
    }
  }
  return placed;
}

export function radiusForImpact(impact, maxImpact, { seed = false } = {}) {
  const scale = Math.sqrt(Math.max(impact || 0, 0)) / Math.sqrt(Math.max(maxImpact, 1));
  return (seed ? 8 : 5) + scale * 26;
}

export function timelineLayout(papers, { width, height, mode, impactOf }) {
  if (!papers.length) {
    return { nodes: [], x0: 2000, x1: 2020, minYear: 2000, maxYear: 2020, pad: { l: 68, r: 28, t: 22, b: 46 }, mode };
  }
  const pad = { l: 68, r: 28, t: 22, b: 46 };
  const plotW = Math.max(20, width - pad.l - pad.r);
  const plotH = Math.max(20, height - pad.t - pad.b);
  const years = papers.map((paper) => paper.year).filter((year) => Number.isFinite(year));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const x0 = minYear - 0.85;
  const x1 = Math.max(maxYear + 0.85, x0 + 1);
  const xPix = (year) => pad.l + ((year - x0) / (x1 - x0)) * plotW;
  const impacts = papers.map((paper) => Math.max(impactOf(paper) || 0, 0));
  const maxImpact = Math.max(1, ...impacts);

  if (mode === "beeswarm") {
    const groups = new Map();
    for (const paper of papers) {
      if (!groups.has(paper.year)) groups.set(paper.year, []);
      groups.get(paper.year).push(paper);
    }
    const nodes = [];
    for (const [year, group] of groups) {
      const sorted = [...group].sort((a, b) => (impactOf(b) || 0) - (impactOf(a) || 0));
      const placed = [];
      const x = xPix(year);
      for (const paper of sorted) {
        const r = radiusForImpact(impactOf(paper), maxImpact, { seed: paper.is_seed });
        let y = pad.t + plotH / 2;
        let found = false;
        for (let step = 0; step < 500 && !found; step += 1) {
          const candidates = step === 0 ? [y] : [y + step * 2, y - step * 2];
          for (const candidate of candidates) {
            const clear = placed.every((other) => Math.hypot(x - other.x, candidate - other.y) >= r + other.r + 1.5);
            if (clear) {
              y = candidate;
              found = true;
              break;
            }
          }
        }
        const node = { id: paper.id, x, y, r, year };
        placed.push(node);
        nodes.push(node);
      }
    }
    const minY = Math.min(...nodes.map((node) => node.y - node.r));
    const maxY = Math.max(...nodes.map((node) => node.y + node.r));
    const span = Math.max(1, maxY - minY);
    if (span > plotH) {
      for (const node of nodes) {
        const center = (node.y - minY) / span;
        node.y = pad.t + node.r + center * Math.max(1, plotH - node.r * 2);
      }
    }
    return { nodes, x0, x1, minYear, maxYear, pad, mode, xPix };
  }

  const logs = impacts.map((value) => Math.log10(Math.max(value, 1)));
  const minL = Math.min(...logs);
  const maxL = Math.max(...logs);
  const y0 = minL - 0.35;
  const y1 = maxL + 0.5;
  const yPix = (log) => pad.t + ((y1 - log) / (y1 - y0 || 1)) * plotH;
  const nodes = papers.map((paper, index) => {
    const jitter = ((hash(paper.id) % 1000) / 1000 - 0.5) * 0.46;
    return {
      id: paper.id,
      x: xPix(paper.year + jitter),
      y: yPix(logs[index]),
      r: radiusForImpact(impacts[index], maxImpact, { seed: paper.is_seed }),
      year: paper.year,
    };
  });
  for (let iter = 0; iter < 36; iter += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 1.4;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        dx /= dist;
        dy /= dist;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
    for (const node of nodes) {
      node.x = Math.min(xPix(node.year + 0.42), Math.max(xPix(node.year - 0.42), node.x));
      node.y = Math.min(pad.t + plotH - node.r, Math.max(pad.t + node.r, node.y));
    }
  }
  return { nodes, x0, x1, y0, y1, minYear, maxYear, pad, mode, xPix, yPix };
}

export function networkLayout(papers, { width, height, centerId }) {
  if (!papers.length) return [];
  const cx = width / 2;
  const cy = height / 2;
  const maxR = Math.min(width, height) * 0.4;
  const maxImpact = Math.max(1, ...papers.map((paper) => paper.cited_by_count || 0));
  const seed = papers.find((paper) => paper.id === centerId) || papers.find((paper) => paper.is_seed) || papers[0];
  const others = papers.filter((paper) => paper.id !== seed.id);
  const groups = new Map();
  for (const paper of others) {
    const key = paper.venue_group || "其他";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(paper);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const total = others.length || 1;
  let angle = -Math.PI / 2;
  const nodes = [{
    id: seed.id,
    x: cx,
    y: cy,
    r: radiusForImpact(seed.cited_by_count, maxImpact, { seed: true }) + 4,
    fixed: true,
    targetR: 0,
  }];
  for (const [, group] of ordered) {
    const span = (group.length / total) * Math.PI * 2;
    const usable = Math.max(span * 0.92, 0.04);
    group.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
    group.forEach((paper, index) => {
      const relevance = Math.max(0, Math.min(1, paper.relevance_score || 0));
      const lane = ((index % 4) - 1.5) * Math.min(26, maxR * 0.08);
      const targetR = Math.min(maxR, Math.max(52, (1 - relevance) ** 0.72 * maxR + lane));
      const theta = angle + ((index + 0.5) / group.length) * usable;
      nodes.push({
        id: paper.id,
        x: cx + Math.cos(theta) * targetR,
        y: cy + Math.sin(theta) * targetR,
        r: radiusForImpact(paper.cited_by_count, maxImpact) * (papers.length > 80 ? 0.72 : 1),
        fixed: false,
        targetR,
      });
    });
    angle += span;
  }
  for (let iter = 0; iter < 70; iter += 1) {
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 8;
        if (dist >= min) continue;
        const push = (min - dist) / 2;
        dx /= dist;
        dy /= dist;
        if (!a.fixed) { a.x -= dx * push; a.y -= dy * push; }
        if (!b.fixed) { b.x += dx * push; b.y += dy * push; }
      }
    }
    for (const node of nodes) {
      if (node.fixed) {
        node.x = cx;
        node.y = cy;
        continue;
      }
      const dx = node.x - cx;
      const dy = node.y - cy;
      const dist = Math.hypot(dx, dy) || 0.01;
      const next = dist + (node.targetR - dist) * 0.08;
      node.x = cx + (dx / dist) * next;
      node.y = cy + (dy / dist) * next;
    }
  }
  return nodes;
}

export function aggregateByYearVenue(papers, impactMode) {
  const groups = new Map();
  for (const paper of papers) {
    const key = `${paper.year ?? "Unknown"}::${paper.venue_group || "Unknown"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(paper);
  }
  return [...groups.values()].map((members) => {
    const cited = members.reduce((sum, paper) => sum + (paper.cited_by_count || 0), 0);
    const perYearValues = members.map((paper) => paper.impact_per_year).filter((value) => value != null);
    const perYear = perYearValues.length
      ? Math.round((perYearValues.reduce((sum, value) => sum + value, 0)) * 100) / 100
      : null;
    const head = members[0];
    return {
      id: `agg:${head.year}:${head.venue_group}`,
      title: `${head.venue_short || head.venue_group} · ${head.year ?? "Unknown"} · ${members.length} 篇`,
      year: head.year,
      venue: head.venue_group,
      venue_short: head.venue_short || head.venue_group,
      venue_group: head.venue_group,
      cited_by_count: cited,
      impact_score: cited,
      impact_per_year: perYear,
      impact_mode: impactMode,
      authors: [],
      author_string: `${members.length} 篇`,
      abstract: null,
      doi: null,
      is_seed: members.some((paper) => paper.is_seed),
      isAggregate: true,
      members,
      relevance_score: Math.max(...members.map((paper) => paper.relevance_score || 0)),
      relation: "semantic",
    };
  });
}
