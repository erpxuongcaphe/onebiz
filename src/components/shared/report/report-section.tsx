"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "border-border bg-muted/50",
  primary: "border-primary/40 bg-primary/5",
  review: "border-status-warning/40 bg-status-warning/5",
};

export function ReportSection({ title, subtitle, children, actions, tone = "neutral", className }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  const titleId = useId();
  return <section aria-labelledby={titleId} className={cn("min-w-0 border-t border-border", className)}>
    <header className={cn("flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-l-4 px-3 py-3", TONES[tone])}>
      <div className="min-w-0 flex-1 basis-60">
        <h2 id={titleId} className="break-words text-base font-semibold leading-6 text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
    <div className="min-w-0 pt-3">{children}</div>
  </section>;
}
