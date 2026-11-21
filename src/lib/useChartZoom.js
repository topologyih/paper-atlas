import { useEffect, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";

export function useChartZoom(svgRef, worldRef, resetToken, onZoom) {
  const behaviorRef = useRef(null);
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  useEffect(() => {
    const svg = svgRef.current;
    const world = worldRef.current;
    if (!svg || !world) return undefined;
    let frame = 0;
    const behavior = zoom()
      .scaleExtent([0.35, 8])
      .filter((event) => {
        if (event.type === "dblclick") return false;
        if (event.type === "wheel") return true;
        if (event.target?.closest?.("[data-node]")) return false;
        return !event.button;
      })
      .on("zoom", (event) => {
        world.setAttribute("transform", event.transform.toString());
        const next = event.transform.k;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => onZoomRef.current?.(next));
      });
    const selection = select(svg);
    selection.call(behavior);
    behaviorRef.current = behavior;
    return () => {
      cancelAnimationFrame(frame);
      selection.on(".zoom", null);
    };
  }, [svgRef, worldRef]);

  useEffect(() => {
    if (!resetToken) return;
    const svg = svgRef.current;
    const behavior = behaviorRef.current;
    if (!svg || !behavior) return;
    select(svg).call(behavior.transform, zoomIdentity);
  }, [resetToken, svgRef]);
}

export function useElementSize(ref) {
  const [size, setSize] = useState({ width: 960, height: 640 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(420, Math.floor(rect.height));
      setSize((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
