import { useEffect, useState, type RefObject } from 'react';

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Minimal fixed-height list windowing, so a tab holding thousands of notes
 * renders only the rows on screen.
 *
 * When the container has no measurable height — the first paint, and any
 * non-layout environment such as jsdom — every row is rendered. That keeps
 * behaviour correct (and testable) instead of silently showing nothing.
 */
export function useVirtualRows(
  containerRef: RefObject<HTMLElement | null>,
  itemCount: number,
  rowHeight: number,
  overscan = 6,
): VirtualWindow {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const onScroll = () => setScrollTop(element.scrollTop);
    const measure = () => setViewportHeight(element.clientHeight);

    measure();
    element.addEventListener('scroll', onScroll, { passive: true });

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    observer?.observe(element);

    return () => {
      element.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [containerRef, itemCount]);

  if (viewportHeight <= 0 || itemCount === 0) {
    return { startIndex: 0, endIndex: itemCount, paddingTop: 0, paddingBottom: 0 };
  }

  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(itemCount, startIndex + visibleCount);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: Math.max(0, (itemCount - endIndex) * rowHeight),
  };
}
