export function showText(value) {
  if (value == null) return "Unknown";
  const text = String(value).trim();
  return text || "Unknown";
}

export function showNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "Unknown";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
}

export function snippet(value, length = 220) {
  if (!value) return "Unknown";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return "Unknown";
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function shortTitle(title, length = 42) {
  const text = showText(title);
  if (text === "Unknown") return text;
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export function csvEscape(value) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
