import type { BrainstormMockMiniature } from "@pi-harness/shared";

type RowsMiniature = Extract<BrainstormMockMiniature, { kind: "rows" }>;

export function RowsPreview({ miniature }: { readonly miniature: RowsMiniature }) {
  return (
    <div className="mini-preview rows-preview" aria-hidden="true">
      <div className="mini-head">
        <span className="mini-dot" />
        verify rows
        <span className="mini-spacer">live</span>
      </div>
      <div className="mini-rows">
        {miniature.rows.slice(0, 5).map((row, index) => (
          <div key={`${row.label}:${index}`} className={`mini-row status-${row.status}`}>
            <span className="mini-status">{row.status === "pass" ? "PASS" : row.status === "fail" ? "FAIL" : "--"}</span>
            <span className="mini-copy">
              <span>{row.label}</span>
              {row.sub && <em>{row.sub}</em>}
            </span>
            {row.action && <span className="mini-action">{row.action}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
