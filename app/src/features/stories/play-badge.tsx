"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Sits inside the picture. Stays hidden until that picture has a real box, so it cannot float over the source line. */
export function PlayBadge(): ReactNode {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const img = ref.current?.parentElement?.querySelector("img");
    if (!img) return;
    const mark = (): void => setReady(img.clientWidth > 8 && img.clientHeight > 8);
    mark();
    img.addEventListener("load", mark);
    const observer = new ResizeObserver(mark);
    observer.observe(img);
    return () => {
      img.removeEventListener("load", mark);
      observer.disconnect();
    };
  }, []);
  return <span ref={ref} className="media-play" hidden={!ready} aria-hidden="true">▶</span>;
}
