import { clsx } from "clsx";
import type { MockPlanScenario, MockPlanScenarioKind } from "@/types/mocks";
import { InlineMd } from "./inline-md";

const KIND_DOT: Record<MockPlanScenarioKind, string> = {
  unit: "bg-st-done",
  api: "bg-st-progress",
  visual: "bg-st-review",
};

export function ScenarioEditor({ scenarios }: { scenarios: MockPlanScenario[] }) {
  return (
    <aside className="overflow-auto bg-bg">
      <header className="border-b border-line px-6 pb-3 pt-4">
        <h2 className="m-0 font-display text-[14px] font-semibold tracking-[-0.01em] text-fg">
          Scenarios
        </h2>
        <p className="mt-1 text-[12px] leading-[1.55] text-fg-mute">
          Each scenario the verify phase will run. Pulled from the Scenarios library where
          possible — toggling one off skips it for this run only.
        </p>
      </header>

      <ul className="m-0 list-none px-4 py-2 pb-4">
        {scenarios.map((s) => (
          <ScenarioRow key={s.id} scenario={s} />
        ))}
        <li className="mx-2 mt-1 flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-line p-2.5 font-mono text-[11.5px] text-fg-mute transition-colors hover:border-line-hover hover:bg-white/[0.02] hover:text-fg-body">
          <PlusIcon />
          <span>add scenario · pick from library or write inline</span>
        </li>
      </ul>
    </aside>
  );
}

function ScenarioRow({ scenario: s }: { scenario: MockPlanScenario }) {
  const off = !s.enabled;
  return (
    <li className="group grid cursor-pointer grid-cols-[18px_1fr_auto] gap-3 border-b border-line px-2 py-3 transition-colors hover:bg-white/[0.025]">
      <Check on={s.enabled} />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <KindChip kind={s.kind} />
          <span className="font-mono text-[10.5px] text-fg-subtle">{s.id}</span>
          <SourceLabel source={s.source} />
        </div>
        <div
          className={clsx(
            "mb-1 text-[13px] font-medium leading-[1.45] tracking-[-0.005em]",
            off ? "text-fg-mute" : "text-fg",
          )}
        >
          <InlineMd text={s.name} />
        </div>
        <div className="break-all rounded border border-line bg-input px-2.5 py-1.5 font-mono text-[11px] leading-[1.55] text-fg-body">
          {s.expression}
        </div>
      </div>
      <span className="cursor-pointer self-start px-1 text-[14px] text-fg-ghost opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg">
        <MenuIcon />
      </span>
    </li>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      className={clsx(
        "relative mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] border",
        on
          ? "border-st-progress bg-st-progress"
          : "border-line-strong border-dashed",
      )}
      aria-hidden="true"
    >
      {on && (
        <span
          className="absolute left-[3px] top-0 h-[9px] w-[5px] rotate-45 border-b-[1.5px] border-r-[1.5px] border-white"
          style={{ borderColor: "#fff" }}
        />
      )}
    </span>
  );
}

function KindChip({ kind }: { kind: MockPlanScenarioKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-line px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.06em] text-fg-subtle">
      <span className={clsx("h-[5px] w-[5px] rounded-full", KIND_DOT[kind])} />
      {kind}
    </span>
  );
}

function SourceLabel({ source }: { source: MockPlanScenario["source"] }) {
  if (source === "new") {
    return <span className="ml-auto font-mono text-[10.5px] text-st-done">new · this run</span>;
  }
  return <span className="ml-auto font-mono text-[10.5px] text-fg-subtle">from library</span>;
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M 8 3.5 L 8 12.5 M 3.5 8 L 12.5 8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}
