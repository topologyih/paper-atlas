import { findArxiv, findDoi } from "./parseInput.js";

function guessTitle(text) {
  const bad = /^(abstract|introduction|arxiv:|doi:|www\.|http|proceedings|copyright|vol\.|pp\.|keywords)/i;
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const candidates = [];
  for (const line of lines.slice(0, 25)) {
    if (bad.test(line) || line.includes("@")) continue;
    if (line.length < 12 || line.length > 220) continue;
    const letters = [...line].filter((char) => /\p{L}/u.test(char)).length;
    if (letters < 8) continue;
    candidates.push(line);
  }
  if (!candidates.length) return null;
  return candidates.slice(0, 8).sort((a, b) => b.length - a.length)[0];
}

export function queryFromText(text) {
  const head = text || "";
  const doi = findDoi(head.slice(0, 6000));
  if (doi) return { kind: "doi", value: doi };
  const arxiv = findArxiv(head.slice(0, 2500), { bare: false });
  if (arxiv) return { kind: "arxiv", value: arxiv };
  const title = guessTitle(head);
  if (title) return { kind: "title", value: title };
  return { kind: "invalid", value: "" };
}

export async function extractPdfQuery(file) {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = Math.min(doc.numPages, 2);
  let text = "";
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    text += `${content.items.map((item) => item.str).join(" ")}\n`;
  }
  const found = queryFromText(text);
  if (found.kind !== "invalid") return found;
  const raw = new TextDecoder("latin1").decode(data.slice(0, 400000));
  return queryFromText(raw);
}
