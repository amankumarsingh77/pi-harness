import { clsx } from "clsx";

export function Card({
  accent,
  className,
  children,
}: {
  accent?: "violet" | "blue" | "amber" | "cyan" | "red" | "green";
  className?: string;
  children: React.ReactNode;
}) {
  const accentBorder = accent ? `border-${accent}-fg/30` : "border-border-soft";
  return (
    <div
      className={clsx(
        "rounded-md border bg-sub p-3 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset,0_1px_2px_rgba(0,0,0,0.4)]",
        accentBorder,
        className,
      )}
    >
      {children}
    </div>
  );
}
