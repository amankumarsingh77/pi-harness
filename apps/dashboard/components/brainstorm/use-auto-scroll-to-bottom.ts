"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useAutoScrollToBottom<T extends HTMLElement>({
  itemCount,
  threshold = 32,
}: {
  readonly itemCount: number;
  readonly threshold?: number;
}) {
  const ref = useRef<T | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const priorCount = useRef(itemCount);

  const isNearBottom = useCallback((): boolean => {
    const node = ref.current;
    if (!node) return true;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
  }, [threshold]);

  const scrollToBottom = useCallback((): void => {
    const node = ref.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    setAtBottom(true);
    setNewCount(0);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const onScroll = (): void => {
      const near = isNearBottom();
      setAtBottom(near);
      if (near) setNewCount(0);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => node.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    const delta = itemCount - priorCount.current;
    priorCount.current = itemCount;
    if (delta <= 0) return;
    if (isNearBottom()) {
      requestAnimationFrame(scrollToBottom);
      return;
    }
    setAtBottom(false);
    setNewCount((count) => count + delta);
  }, [isNearBottom, itemCount, scrollToBottom]);

  return { ref, atBottom, newCount, scrollToBottom };
}
