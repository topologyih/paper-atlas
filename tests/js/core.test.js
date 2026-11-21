import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyFilters } from "../../src/lib/filter.js";
import { placeNodeLabels, timelineLayout, yearAxisTicks, zoomSpread } from "../../src/lib/layout.js";
import { parseQuery } from "../../src/lib/parseInput.js";
import { RELEVANCE_WEIGHTS, impactPerYear, scoreRelevance } from "../../src/lib/score.js";

const weights = JSON.parse(readFileSync(new URL("../fixtures/weights.json", import.meta.url), "utf8"));
const cases = JSON.parse(readFileSync(new URL("../fixtures/parse_cases.json", import.meta.url), "utf8"));
const sample = JSON.parse(readFileSync(new URL("../../public/sample.json", import.meta.url), "utf8"));

test("parse fixtures match the shared cases", () => {
  for (const item of cases) {
    const parsed = parseQuery(item.q);
    assert.equal(parsed.kind, item.kind, item.q);
    assert.equal(parsed.value, item.value, item.q);
  }
});

test("relevance weights match the locked fixture and sum to 1", () => {
  assert.deepEqual(RELEVANCE_WEIGHTS, weights);
  const total = Object.values(RELEVANCE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("seed scores 1 and a direct citation keeps the direct part", () => {
  const center = {
    id: "S",
    title: "Attention Is All You Need",
    abstract: "transformer sequence transduction",
    referenced_works: ["R"],
    topic_ids: ["T"],
    related_works: [],
  };
  const seedScore = scoreRelevance(center, center, { cocoAvailable: true });
  assert.equal(seedScore.score, 1);
  const citing = {
    id: "C",
    title: "BERT language model",
    abstract: "bidirectional transformer",
    referenced_works: ["S"],
    topic_ids: [],
    related_works: [],
  };
  const scored = scoreRelevance(citing, center, { cocoScore: 0, cocoAvailable: true });
  assert.equal(scored.parts.direct, 1);
  assert.ok(scored.score > 0 && scored.score <= 1);
});

test("missing cocitation drops that weight and renormalizes", () => {
  const center = { id: "S", title: "alpha beta", abstract: "", referenced_works: [], topic_ids: [], related_works: [] };
  const paper = { id: "P", title: "gamma delta", abstract: "", referenced_works: ["S"], topic_ids: [], related_works: [] };
  const scored = scoreRelevance(paper, center, { cocoScore: 1, cocoAvailable: false });
  assert.equal(scored.parts.cocitation, 0);
  assert.equal(scored.parts.direct, 1);
  const kept = 0.3 + 0.26 + 0.14 + 0.1 + 0.04;
  assert.equal(scored.score, Math.round((0.3 / kept) * 10000) / 10000);
});

test("impact per year uses the impact year and a floor of one", () => {
  assert.equal(impactPerYear(100, 2016, 2026), 10);
  assert.equal(impactPerYear(100, 2026, 2026), 100);
  assert.equal(impactPerYear(null, 2016, 2026), null);
});

test("timeline x positions stay inside their publication year", () => {
  const papers = [];
  for (let index = 0; index < 40; index += 1) {
    papers.push({
      id: `p${index}`,
      year: 2017 + (index % 5),
      cited_by_count: 10 + index * 97,
      is_seed: index === 0,
    });
  }
  for (const mode of ["impact", "beeswarm"]) {
    const layout = timelineLayout(papers, {
      width: 960,
      height: 640,
      mode,
      impactOf: (paper) => paper.cited_by_count,
    });
    const byYear = new Map();
    for (const node of layout.nodes) {
      const left = layout.xPix(node.year - 0.45);
      const right = layout.xPix(node.year + 0.45);
      assert.ok(node.x >= left - 0.01 && node.x <= right + 0.01, `${mode} ${node.id}`);
      const bucket = byYear.get(node.year) || [];
      bucket.push(node.x);
      byYear.set(node.year, bucket);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    for (let index = 1; index < years.length; index += 1) {
      const previousMax = Math.max(...byYear.get(years[index - 1]));
      const currentMin = Math.min(...byYear.get(years[index]));
      assert.ok(previousMax < currentMin, `${mode} ${years[index - 1]} overlaps ${years[index]}`);
    }
  }
});

test("long timelines label years far enough apart to read", () => {
  const minYear = 1971;
  const maxYear = 2026;
  const width = 1100;
  const pad = { l: 68, r: 28 };
  const plotW = width - pad.l - pad.r;
  const x0 = minYear - 0.85;
  const x1 = maxYear + 0.85;
  const xPix = (year) => pad.l + ((year - x0) / (x1 - x0)) * plotW;
  const ticks = yearAxisTicks(minYear, maxYear, xPix);
  assert.equal(ticks[0], minYear);
  assert.equal(ticks[ticks.length - 1], maxYear);
  assert.ok(ticks.length < 16);
  for (let index = 1; index < ticks.length; index += 1) {
    assert.ok(xPix(ticks[index]) - xPix(ticks[index - 1]) >= 58);
  }
  const shortPix = (year) => pad.l + ((year - 2016) / (2027 - 2016)) * plotW;
  const short = yearAxisTicks(2017, 2026, shortPix);
  assert.ok(short.length >= 8);
});

test("clustered titles keep apart or drop instead of stacking", () => {
  const nodes = [
    { id: "a", x: 200, y: 80, r: 32 },
    { id: "b", x: 230, y: 96, r: 30 },
    { id: "c", x: 255, y: 78, r: 28 },
    { id: "d", x: 720, y: 240, r: 16 },
  ];
  const titles = new Map([
    ["a", "Attention Is All You Need"],
    ["b", "BERT: Pre-training of Deep"],
    ["c", "Adam: A Method for Stochas"],
    ["d", "A distant paper title"],
  ]);
  const labels = placeNodeLabels(nodes, titles, { maxLabels: 4, priorityIds: ["a"] });
  const ids = labels.map((label) => label.id);
  assert.ok(ids.includes("a"));
  assert.ok(ids.includes("d"));
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const left = labels[i].box;
      const right = labels[j].box;
      const overlap = left.x < right.x2 && left.x2 > right.x && left.y < right.y2 && left.y2 > right.y;
      assert.equal(overlap, false);
    }
  }
});

test("zooming in spreads a tight cluster and leaves the overview in place", () => {
  const nodes = [
    { id: "a", x: 100, y: 100, r: 30 },
    { id: "b", x: 112, y: 108, r: 28 },
    { id: "c", x: 124, y: 96, r: 26 },
    { id: "d", x: 640, y: 320, r: 12 },
  ];
  const rest = zoomSpread(nodes, 1, { yearWidth: 18 });
  assert.equal(rest.find((node) => node.id === "a").sx, 100);
  assert.equal(rest.find((node) => node.id === "a").sr, 30);
  const zoomed = zoomSpread(nodes, 4, { yearWidth: 18 });
  const before = Math.hypot(12, 8);
  const pair = (id) => zoomed.find((node) => node.id === id);
  const after = Math.hypot(pair("b").sx - pair("a").sx, pair("b").sy - pair("a").sy);
  assert.ok(after > before * 1.8);
  const far = pair("d");
  assert.ok(Math.hypot(far.sx - 640, far.sy - 320) < 1);
  const screenGap = after * 4;
  const screenRadii = (pair("a").sr + pair("b").sr) * 4;
  assert.ok(screenGap > screenRadii * 0.72);
});

test("filters keep the center paper when the year range excludes it", () => {
  const papers = [
    { id: "s", year: 2017, title: "seed paper", cited_by_count: 10, relevance_score: 1, venue_group: "arXiv", topics: [], author_string: "", abstract: "" },
    { id: "a", year: 2020, title: "later paper", cited_by_count: 90, relevance_score: 0.4, venue_group: "Nature", topics: ["NLP"], author_string: "", abstract: "" },
  ];
  const result = applyFilters(papers, {
    yearMin: 2020,
    yearMax: 2020,
    dataYearMin: 2017,
    dataYearMax: 2020,
    keyword: "",
    topics: [],
    hiddenVenues: [],
    impactMode: "citations",
    minImpact: 0,
    topN: 0,
    centerId: "s",
  });
  assert.equal(result.centerOutside, true);
  assert.ok(result.papers.some((paper) => paper.id === "s"));
});

test("built-in sample is a real deduped Attention graph", () => {
  assert.ok(sample.papers.length >= 30);
  assert.equal(sample.papers[0].title, "Attention Is All You Need");
  assert.equal(sample.papers[0].id, "W2626778328");
  assert.ok(sample.papers[0].cited_by_count > 50000);
  const ids = new Set(sample.papers.map((paper) => paper.id));
  assert.equal(ids.size, sample.papers.length);
  for (const edge of sample.edges) {
    assert.ok(ids.has(edge.source) && ids.has(edge.target));
    assert.ok(edge.type === "citation" || edge.type === "similarity");
  }
  for (const paper of sample.papers) {
    assert.ok(paper.relevance_score >= 0 && paper.relevance_score <= 1);
    assert.ok(paper.title);
  }
  assert.ok((sample.meta.warnings || []).length > 0);
});
