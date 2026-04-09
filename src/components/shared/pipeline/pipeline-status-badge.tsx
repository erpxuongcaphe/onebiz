"use client";

import { cn } from "@/lib/utils";

interface PipelineStatusBadgeProps {
  name: string;
  /** Stage color hex (e.g. "#10b981"). Falls back to neutral. */
  color?: string;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Color-aware status badge driven by pipeline_stage data.
 * Uses inline color so any stage color from DB renders consistently.
 */
export function PipelineStatusBadge({
  name,
  color,
  size = "md",
  className,
}: PipelineStatusBadgeProps) {
  const fallback = "#94a3b8"; // slate-400
  const c = color || fallback;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className
      )}
      style={{
        backgroundColor: `${c}1a`, // ~10% alpha
        color: c,
      }}
    >
      <span
        className="inline-block rounded-full"
        style={{
          width: size === "sm" ? 6 : 7,
          height: size === "sm" ? 6 : 7,
          backgroundColor: c,
        }}
      />
      {name}
    </span>
  );
}
