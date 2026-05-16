"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { clsx } from "clsx";

export function TopbarNav({ worktreesCount = 0 }: { worktreesCount?: number }) {
  const pathname = usePathname();
  const isRuns = pathname?.startsWith("/runs") ?? false;
  const isScenarios = pathname?.startsWith("/scenarios") ?? false;
  const isBoard = !isRuns && !isScenarios;
  return (
    <nav className="hidden items-center gap-0.5 sm:flex">
      <NavLink href="/" active={isBoard}>Board</NavLink>
      <NavLink href="/runs" active={isRuns}>Runs</NavLink>
      <NavLink href="/scenarios" active={isScenarios}>Scenarios</NavLink>
      <span className="rounded px-2.5 py-1 text-[12.5px] text-fg-mute">
        Worktrees {worktreesCount}
      </span>
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
      className={clsx(
        "rounded px-2.5 py-1 text-[12.5px] transition-colors duration-150",
        active ? "text-fg" : "text-fg-mute hover:bg-white/[0.04] hover:text-fg-body",
      )}
    >
      {children}
    </Link>
  );
}
