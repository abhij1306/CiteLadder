import { useEffect, useState, type RefObject } from 'react';

/** Which sides of a sideways-scrolling region hide more content. */
type ScrollEdges = Readonly<{ start: boolean; end: boolean }>;

const NO_EDGES: ScrollEdges = { start: false, end: false };

/** One pixel of slack, so sub-pixel layout never shows a fade at rest. */
function edgesOf(node: HTMLElement): ScrollEdges {
  const hidden = node.scrollWidth - node.clientWidth;
  if (hidden <= 1) return NO_EDGES;
  // `scrollLeft` runs negative in a right-to-left region.
  const scrolled = Math.abs(node.scrollLeft);
  return { start: scrolled > 1, end: scrolled < hidden - 1 };
}

/**
 * Whether the region `ref` points at can scroll sideways, and towards which
 * side, kept current on scroll and on any resize of the region or its
 * content. Both stay false while nothing overflows.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState(NO_EDGES);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const next = edgesOf(node);
      setEdges((current) =>
        current.start === next.start && current.end === next.end ? current : next,
      );
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    // The content can grow (a page of longer rows) while the region keeps its size.
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref]);
  return edges;
}

/**
 * The overflow cue: a 24px fade at each side of a scrolling region that hides
 * more content, laid over the region (`scroll-edge-fade`), so it never moves
 * anything and is absent while nothing overflows. The region's parent is the
 * positioned box the fades sit in. `start={false}` drops the leading fade
 * where a pinned first column already marks that edge.
 */
export function ScrollEdgeFades({
  edges,
  start = true,
}: Readonly<{ edges: ScrollEdges; start?: boolean }>) {
  return (
    <>
      {start && edges.start ? (
        <span aria-hidden data-scroll-edge="start" className="scroll-edge-fade" />
      ) : null}
      {edges.end ? <span aria-hidden data-scroll-edge="end" className="scroll-edge-fade" /> : null}
    </>
  );
}
