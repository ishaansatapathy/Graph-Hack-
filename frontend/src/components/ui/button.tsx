import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent/90 shadow-[inset_0_1px_0_0_var(--highlight)] font-medium",
  secondary: "bg-surface-2 text-fg border border-line-strong hover:bg-surface-3 shadow-[inset_0_1px_0_0_var(--highlight)]",
  ghost: "text-fg-2 hover:text-fg hover:bg-surface-2",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] transition-[background-color,color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-7 px-2.5 text-[12px]",
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-11 px-5 text-[14px]",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
