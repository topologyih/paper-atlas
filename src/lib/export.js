import { csvEscape } from "./format.js";

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(papers) {
  const columns = [
    "id", "title", "author_string", "year", "venue", "cited_by_count", "impact_per_year",
    "relevance_score", "relation", "doi", "arxiv_id", "oa_url", "pdf_url", "topics", "abstract",
  ];
  const lines = [columns.join(",")];
  for (const paper of papers) {
    lines.push(columns.map((column) => csvEscape(paper[column])).join(","));
  }
  downloadBlob(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }), "paper-atlas.csv");
}

export function svgMarkup(svg) {
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("width")) clone.setAttribute("width", String(svg.clientWidth || 1200));
  if (!clone.getAttribute("height")) clone.setAttribute("height", String(svg.clientHeight || 800));
  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svg, filename) {
  downloadBlob(new Blob([svgMarkup(svg)], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export function downloadPng(svg, filename) {
  const markup = svgMarkup(svg);
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const scale = 2;
    const width = svg.clientWidth || svg.viewBox.baseVal.width || 1200;
    const height = svg.clientHeight || svg.viewBox.baseVal.height || 800;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = "#10141c";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) downloadBlob(png, filename);
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  image.onerror = () => URL.revokeObjectURL(url);
  image.src = url;
}
