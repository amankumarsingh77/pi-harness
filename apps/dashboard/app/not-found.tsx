import Link from "next/link";

export default function RootNotFound() {
  const links = [
    { href: "/", label: "Board" },
    { href: "/runs", label: "Runs" },
    { href: "/tasks/new", label: "New task" },
  ] as const;

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <section className="w-full max-w-lg rounded-lg border border-line bg-card p-6">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-subtle">
          404
        </span>
        <h1 className="m-0 mt-2 text-[22px] font-semibold tracking-[-0.02em] text-fg">
          Page not found.
        </h1>
        <p className="m-0 mt-2 text-[13px] leading-[1.55] text-fg-mute">
          This route is not available. Return to an active workspace view or create a new task.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12.5px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
