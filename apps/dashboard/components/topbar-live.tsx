"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";

export function TopbarShortcuts() {
  const router = useRouter();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      router.push("/tasks/new" as Route);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router]);

  return null;
}

export function LastEventTelemetry({
  initialLastEventAt,
  activeRunIds: _activeRunIds,
}: {
  initialLastEventAt: Date | null;
  activeRunIds: readonly string[];
}) {
  const [lastEventAt] = useState<Date | null>(initialLastEventAt);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const label = useMemo(
    () => (nowMs === null ? "last -" : formatLastEvent(lastEventAt, nowMs)),
    [lastEventAt, nowMs],
  );

  return (
    <>
      <span>{label}</span>
    </>
  );
}

function formatLastEvent(lastEventAt: Date | null, nowMs: number): string {
  if (!lastEventAt) return "last -";
  const seconds = Math.max(0, Math.floor((nowMs - lastEventAt.getTime()) / 1000));
  if (seconds < 60) return `last ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `last ${minutes}m`;
  return `last ${Math.floor(minutes / 60)}h`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
