import type { BrainstormMockMiniature } from "@pi-harness/shared";

type GridDrawerMiniature = Extract<BrainstormMockMiniature, { kind: "grid+drawer" }>;

export function GridDrawerPreview({
  miniature,
}: {
  readonly miniature: GridDrawerMiniature;
}) {
  return (
    <div className="mini-preview grid-drawer-preview" aria-hidden="true">
      <div className="mini-head">
        <span className="mini-dot" />
        assertion grid
        <span className="mini-spacer">review</span>
      </div>
      <div className="mini-grid">
        {miniature.cells.slice(0, 6).map((cell, index) => (
          <span key={index} className={`mini-cell status-${cell.status}`}>
            <span />
            <span />
          </span>
        ))}
      </div>
      <div className="mini-drawer">
        <div className="mini-drawer-head">
          <span>{miniature.drawerTitle}</span>
          <span>{miniature.confirm}</span>
        </div>
        <div className="mini-diff-lines">
          {miniature.diffLines.slice(0, 4).map((line, index) => (
            <span key={index} className={`diff-${line.kind}`}>
              {line.kind === "plus" ? "+" : "-"}
              <i />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
