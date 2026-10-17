import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/** Designed empty / error / loading states used by every panel. */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && (
        <div className="mb-4 grid size-10 place-items-center rounded-[10px] border border-line bg-surface-2 text-fg-3 shadow-[inset_0_1px_0_0_var(--highlight)]">
          {icon}
        </div>
      )}
      <p className="text-[13px] font-medium text-fg">{title}</p>
      {body && <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-fg-3">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry, className }: { title?: string; message?: string; onRetry?: () => void; className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle size={16} strokeWidth={1.5} className="text-conflict" />}
      title={title}
      body={message && <span className="font-mono text-[11.5px] text-fg-2">{message}</span>}
      action={
        onRetry && (
          <Button size="sm" onClick={onRetry}>
            <RotateCw size={12} strokeWidth={1.5} /> Retry
          </Button>
        )
      }
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}
