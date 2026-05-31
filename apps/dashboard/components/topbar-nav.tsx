"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { clsx } from "clsx";

export function TopbarNav() {
  const pathname = usePathname();
  const isRuns = pathname?.startsWith("/runs") ?? false;
  const isScenarios = pathname?.startsWith("/scenarios") ?? false;
  const isChat = pathname?.startsWith("/chat") ?? false;
  const isBoard = !isRuns && !isScenarios && !isChat;
  return (
    <nav className="hidden items-center gap-0.5 sm:flex" aria-label="Primary">
      <NavLink href="/" active={isBoard}>Board</NavLink>
      <NavLink href="/runs" active={isRuns}>Runs</NavLink>
      <NavLink href="/scenarios" active={isScenarios}>Scenarios</NavLink>
      <NavLink href="/chat" active={isChat}>Chat</NavLink>
    </nav>
  );
}

function NavLink({
  href,
  active = false,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "relative inline-flex h-7 items-center rounded px-2.5 text-[12.5px] transition-colors duration-150",
        active
          ? "text-fg after:absolute after:inset-x-2.5 after:-bottom-[9px] after:h-px after:bg-fg"
          : "text-fg-mute hover:bg-white/[0.04] hover:text-fg-body",
      )}
    >
      {children}
    </Link>
  );
}
