import { clsx } from "clsx";

export type ButtonVariant = "default" | "ghost" | "danger" | "disabled";

const V: Record<ButtonVariant, string> = {
  default:  "bg-fg text-bg border border-fg hover:shadow-[0_0_0_3px_rgba(255,255,255,0.06)]",
  ghost:    "bg-sub text-fg-body border border-border hover:bg-card",
  danger:   "bg-red-bg/30 text-red-fg2 border border-red-fg/40 hover:bg-red-bg/50",
  disabled: "bg-sub text-fg-faint border border-border-soft cursor-not-allowed",
};

export function Button(props: {
  variant?: ButtonVariant;
  type?: "button" | "submit";
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const variant = props.variant ?? "default";
  return (
    <button
      type={props.type ?? "button"}
      disabled={variant === "disabled"}
      onClick={props.onClick}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition",
        V[variant],
      )}
    >
      {props.children}
    </button>
  );
}
