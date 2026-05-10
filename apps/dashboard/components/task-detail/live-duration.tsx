"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

export function LiveDuration({
  startedAt,
  suffix,
}: {
  startedAt: Date | string;
  suffix?: string;
}) {
  const start =
    typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const text = formatDuration(Math.max(0, now - start));
  return <>{suffix ? `${text} · ${suffix}` : text}</>;
}
