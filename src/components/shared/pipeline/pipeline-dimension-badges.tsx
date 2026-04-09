"use client";

import { cn } from "@/lib/utils";

interface PipelineDimensionBadgesProps {
  dimensions: Record<string, string>;
  /** Optional label map: dimension key → human label */
  labels?: Record<string, string>;
  /** Optional value map: dimension key → value-color/label map */
  valueLabels?: Record<string, Record<string, { label: string; color?: string }>>;
  className?: string;
}

const DEFAULT_LABELS: Record<string, string> = {
  payment: "Thanh toán",
  fulfillment: "Giao hàng",
  receive: "Nhận hàng",
  quality: "Chất lượng",
  refund: "Hoàn tiền",
  cod: "COD",
  temperature: "Độ ấm",
  engagement: "Tương tác",
  material: "Vật tư",
};

const DEFAULT_VALUE_COLORS: Record<string, string> = {
  paid: "#10b981",
  unpaid: "#ef4444",
  partial: "#f59e0b",
  pending: "#94a3b8",
  ready: "#3b82f6",
  shipped: "#8b5cf6",
  delivered: "#10b981",
  ok: "#10b981",
  failed: "#ef4444",
  hot: "#ef4444",
  warm: "#f59e0b",
  cold: "#3b82f6",
};

/**
 * Renders multi-dimension state of a pipeline item as compact pill badges.
 * Each dimension is independent (e.g. payment + fulfillment shown separately).
 */
export function PipelineDimensionBadges({
  dimensions,
  labels = DEFAULT_LABELS,
  valueLabels,
  className,
}: PipelineDimensionBadgesProps) {
  const entries = Object.entries(dimensions || {});
  if (entries.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {entries.map(([key, value]) => {
        const label = labels[key] ?? key;
        const customValue = valueLabels?.[key]?.[value];
        const valueLabel = customValue?.label ?? value;
        const color =
          customValue?.color ?? DEFAULT_VALUE_COLORS[value] ?? "#94a3b8";

        return (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded text-[11px] px-1.5 py-0.5 border"
            style={{
              backgroundColor: `${color}1a`,
              color,
              borderColor: `${color}40`,
            }}
          >
            <span className="opacity-70">{label}:</span>
            <span className="font-medium">{valueLabel}</span>
          </span>
        );
      })}
    </div>
  );
}
