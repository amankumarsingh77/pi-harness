import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, CheckCircle2, CircleDashed, Palette } from "lucide-react";
import type { DesignSystemSnapshot } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/;

function isColor(v: string): boolean {
  return COLOR_RE.test(v.trim());
}

// Parse `--name: value;` declarations out of a tokens.css string. Only the
// declarations inside :root-style blocks matter, but a flat regex over the
// whole file is sufficient — selectors don't contain `--name: value;`.
function parseTokens(css: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const re = /(--[\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.push({ name: m[1]!.trim(), value: m[2]!.trim() });
  }
  return out;
}

export function DesignSystemView({ snapshot }: { snapshot: DesignSystemSnapshot }) {
  const { manifest } = snapshot;
  const tokens = parseTokens(snapshot.tokensCss);
  const fontDisplay = tokens.find((t) => t.name === "--font-display")?.value;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-fg">Design system</h1>
        <span className="font-mono text-[11px] text-st-done">tokens v{manifest.tokenVersion}</span>
        <span className="font-mono text-[11px] text-fg-mute">
          {tokens.length} tokens · {manifest.exemplars.length} exemplars
        </span>
        <span className="ml-auto font-mono text-[11px] text-fg-faint">
          updated {manifest.updatedAt}
        </span>
      </header>

      <section className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-mute">
            Tokens
          </h2>
          <div className="overflow-hidden rounded border border-line">
            {tokens.map((t) => (
              <div
                key={t.name}
                className="flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-0"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg">
                  {t.name}
                </span>
                {isColor(t.value) && (
                  <span
                    aria-hidden="true"
                    className="inline-block h-3.5 w-3.5 shrink-0 rounded-[2px] ring-1 ring-line"
                    style={{ background: t.value }}
                  />
                )}
                <span className="shrink-0 font-mono text-[11px] text-fg-body">{t.value}</span>
              </div>
            ))}
            {tokens.length === 0 && (
              <div className="px-3 py-2 font-mono text-[11px] text-fg-mute">
                tokens.css defines no custom properties
              </div>
            )}
          </div>
          {fontDisplay && (
            <p
              className="mt-3 text-[22px] text-fg"
              style={{ fontFamily: `var(--font-display), ${fontDisplay}` }}
            >
              Display specimen — {fontDisplay}
            </p>
          )}
        </div>

        <div>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-mute">
            design.md
          </h2>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-line bg-card px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-body">
            {snapshot.designMd}
          </pre>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-mute">
          Gallery
        </h2>
        {manifest.exemplars.length === 0 ? (
          <p className="font-mono text-[11px] text-fg-mute">
            No exemplars promoted at v{manifest.tokenVersion}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {manifest.exemplars.map((ex) => {
              const drift = ex.tokenVersion < manifest.tokenVersion;
              return (
                <figure key={ex.id} className="overflow-hidden rounded border border-line bg-card">
                  <img
                    alt={`Exemplar ${ex.title}`}
                    src={`/api/proxy/design/gallery/${ex.id}/png`}
                    className="block w-full bg-white"
                  />
                  <figcaption className="flex items-center gap-2 border-t border-line px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-body">
                      {ex.title}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-fg-faint">
                      {ex.promotedFromTask}
                    </span>
                    <span
                      title={drift ? "Promoted under an older token version" : undefined}
                      className={`shrink-0 font-mono text-[10.5px] ${
                        drift ? "text-fg-faint" : "text-fg-mute"
                      }`}
                    >
                      v{ex.tokenVersion}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}
      </section>

      {manifest.history.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[11px] uppercase tracking-[0.06em] text-fg-mute">
            Promotion history
          </h2>
          <div className="overflow-hidden rounded border border-line">
            {manifest.history.map((h) => (
              <div
                key={h.tokenVersion}
                className="flex items-baseline gap-3 border-b border-line px-3 py-1.5 last:border-0"
              >
                <span className="shrink-0 font-mono text-[11px] text-st-done">
                  v{h.tokenVersion}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-fg-faint">{h.task}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fg-body">
                  {h.summary}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function DesignSystemEmptyState() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <section
        role="region"
        aria-label="Design system not seeded"
        className="overflow-hidden rounded-lg border border-line bg-card"
      >
        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-white/[0.03] text-st-progress">
            <Palette size={18} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-[18px] font-semibold tracking-[-0.016em] text-fg">
              Design system not seeded
            </h1>
            <p className="m-0 mt-1 max-w-2xl text-[12.5px] leading-5 text-fg-mute">
              Promote a brainstorm mock to create tokens, exemplars, and the design.md source of truth.
            </p>
          </div>
          <span className="ml-auto rounded-full border border-line px-2.5 py-1 font-mono text-[10.5px] text-fg-faint">
            tokens v0
          </span>
        </header>

        <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-fg-faint">
              Setup checklist
            </div>
            <div className="space-y-2">
              <ChecklistItem done label="Create a task with UI scope" />
              <ChecklistItem label="Complete brainstorm mocks" />
              <ChecklistItem label="Promote one mock into the design system" />
              <ChecklistItem label="Review generated tokens and gallery exemplars" />
            </div>
          </div>

          <div className="rounded-lg border border-line bg-input/45 p-4">
            <EmptyState
              title="No promoted mock"
              body="The gallery, token table, and promotion history appear here after the first approved mock is promoted."
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={"/tasks/new" as Route}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-fg px-3 text-[12.5px] font-medium text-bg transition-colors hover:bg-fg/90"
              >
                Create UI task
                <ArrowRight size={13} strokeWidth={1.8} aria-hidden="true" />
              </Link>
              <Link
                href={"/" as Route}
                className="inline-flex h-8 items-center rounded-md border border-line px-3 text-[12.5px] font-medium text-fg-body transition-colors hover:border-line-hover hover:bg-white/[0.03]"
              >
                Open board
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ChecklistItem({
  done = false,
  label,
}: {
  readonly done?: boolean;
  readonly label: string;
}) {
  const Icon = done ? CheckCircle2 : CircleDashed;
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-input/35 px-3 py-2">
      <Icon
        size={14}
        strokeWidth={1.9}
        className={done ? "text-st-done" : "text-fg-faint"}
        aria-hidden="true"
      />
      <span className={done ? "text-[13px] text-fg-body" : "text-[13px] text-fg-mute"}>{label}</span>
    </div>
  );
}
