/** Stable venue colors. The top venues by citation mass each get their own color. */

export const VENUE_COLORS = [
  "#4C9BE8", "#E4A04A", "#3FBF9C", "#E36D8A", "#A78BFA",
  "#F0D06A", "#7EB6D9", "#E07A5F", "#8FD18A", "#F2A2C0",
  "#6C8CFF", "#E6C07B", "#5EC8D8", "#C084FC", "#F0A202",
  "#9AD0F5",
];
export const OTHER_COLOR = "#8B93A7";
export const UNKNOWN_COLOR = "#66707c";

export function assignVenueGroups(papers) {
  const mass = new Map();
  for (const paper of papers) {
    const venue = paper.venue || "Unknown";
    mass.set(venue, (mass.get(venue) || 0) + (paper.cited_by_count || 0) + 1);
  }
  const ranked = [...mass.entries()]
    .filter(([venue]) => venue !== "Unknown")
    .sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 16).map(([venue]) => venue);
  const topSet = new Set(top);
  const colorByGroup = new Map();
  top.forEach((venue, index) => colorByGroup.set(venue, VENUE_COLORS[index % VENUE_COLORS.length]));
  colorByGroup.set("其他", OTHER_COLOR);
  colorByGroup.set("Unknown", UNKNOWN_COLOR);
  const decorated = papers.map((paper) => {
    const venue = paper.venue || "Unknown";
    let venueGroup = "Unknown";
    if (venue !== "Unknown") venueGroup = topSet.has(venue) ? venue : "其他";
    return { ...paper, venue_group: venueGroup };
  });
  return { papers: decorated, colorByGroup, top };
}

export function colorFor(paper, colorByGroup) {
  return colorByGroup.get(paper.venue_group) || OTHER_COLOR;
}
