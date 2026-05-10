"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "pi-harness:brainstorm-split";
const MIN_FRACTION = 0.3;
const MAX_FRACTION = 0.75;
const DEFAULT_FRACTION = 1.4 / (1.4 + 1); // matches the prior grid-cols-[1.4fr_1fr]

// Two-pane horizontal split with a draggable hairline divider. Persists the
// chosen fraction to localStorage so the layout survives navigation. Keyboard
// users can focus the separator and adjust with arrow keys.
//
// The layout is `flex` (not grid) so a percentage on the left pane gives
// stable sizing without the intrinsic-content track expansion that bit the
// diff view in the prior grid-based layout.
export function SplitPane({
  left,
  right,
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [fraction, setFraction] = useState<number>(DEFAULT_FRACTION);
  const dragRef = useRef<{ rect: DOMRect } | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= MIN_FRACTION && n <= MAX_FRACTION) {
          setFraction(n);
        }
      }
    } catch {
      // localStorage may be unavailable (private mode, SSR mismatch); fall
      // back silently to the default.
    }
  }, []);

  const persist = useCallback((next: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // ignore
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    e.preventDefault();
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    dragRef.current = { rect: containerRef.current.getBoundingClientRect() };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const x = e.clientX - drag.rect.left;
    const f = clamp(x / drag.rect.width, MIN_FRACTION, MAX_FRACTION);
    setFraction(f);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.target as HTMLDivElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    persist(fraction);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.02;
    let next = fraction;
    if (e.key === "ArrowLeft") next = clamp(fraction - step, MIN_FRACTION, MAX_FRACTION);
    else if (e.key === "ArrowRight") next = clamp(fraction + step, MIN_FRACTION, MAX_FRACTION);
    else if (e.key === "Home") next = MIN_FRACTION;
    else if (e.key === "End") next = MAX_FRACTION;
    else return;
    e.preventDefault();
    setFraction(next);
    persist(next);
  };

  const onDoubleClick = () => {
    setFraction(DEFAULT_FRACTION);
    persist(DEFAULT_FRACTION);
  };

  const leftPct = `${(fraction * 100).toFixed(3)}%`;

  return (
    <div ref={containerRef} className={`flex min-h-0 ${className ?? ""}`}>
      <div className="flex min-w-0 min-h-0 flex-col" style={{ width: leftPct }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={Math.round(MIN_FRACTION * 100)}
        aria-valuemax={Math.round(MAX_FRACTION * 100)}
        aria-valuenow={Math.round(fraction * 100)}
        tabIndex={0}
        data-testid="split-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={onDoubleClick}
        title="Drag to resize · double-click to reset · arrow keys to nudge"
        className="group relative w-px shrink-0 cursor-col-resize bg-line transition-colors hover:bg-line-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-st-progress"
      >
        {/* Wider invisible hit-area so the 1px line is comfortable to grab. */}
        <span aria-hidden="true" className="absolute -left-1.5 top-0 h-full w-3" />
      </div>
      <div className="flex min-w-0 min-h-0 flex-1 flex-col">{right}</div>
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
