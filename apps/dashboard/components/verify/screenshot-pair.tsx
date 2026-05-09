export function ScreenshotPair({
  expectedUrl,
  actualUrl,
  diffPct,
  caption,
}: {
  expectedUrl: string | null;
  actualUrl: string | null;
  diffPct: number;
  caption: string;
}) {
  const matched = actualUrl && diffPct < 0.5;
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Frame label="EXPECTED" url={expectedUrl} caption={caption} />
      {(() => {
        const accent: "match" | "fail" | undefined = matched
          ? "match"
          : actualUrl
            ? "fail"
            : undefined;
        const frameProps = {
          label: "ACTUAL",
          url: actualUrl,
          caption,
          badge: actualUrl ? `${matched ? "✓" : "✗"} ${diffPct.toFixed(2)}% diff` : null,
          ...(accent !== undefined ? { accent } : {}),
        };
        return <Frame {...frameProps} />;
      })()}
    </div>
  );
}

function Frame({
  label,
  url,
  caption,
  accent,
  badge,
}: {
  label: string;
  url: string | null;
  caption: string;
  accent?: "match" | "fail";
  badge?: string | null;
}) {
  const border = accent === "match" ? "border-green-fg/30" : accent === "fail" ? "border-red-fg/40" : "border-border-soft";
  return (
    <div className={`rounded-md border ${border} overflow-hidden bg-input`}>
      <div className="flex items-center border-b border-border-soft px-2.5 py-2 font-mono text-[9px] font-bold tracking-widest text-fg-subtle">
        {label}
        {badge && (
          <span className="ml-auto rounded border border-green-fg/25 bg-green-fg/10 px-2 py-0.5 text-green-fg2">
            {badge}
          </span>
        )}
      </div>
      <div className="aspect-[16/10] bg-sub flex items-center justify-center text-fg-faint text-[11px]">
        {url ? <img src={url} alt={caption} className="h-full w-full object-contain" /> : "(no image)"}
      </div>
      <div className="border-t border-border-soft px-2.5 py-2 text-[11px] text-fg-subtle">{caption}</div>
    </div>
  );
}
