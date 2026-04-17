"use client";

import { cn } from "@/lib/utils";
import { Icon as MSIcon } from "@/components/ui/icon";

interface KpiCardProps {
  label: string;
  value: string;
  change?: string;
  positive?: boolean;
  /** Material Symbols icon name (e.g. "trending_up", "attach_money") */
  icon: string;
  bg: string;
  iconColor: string;
  valueColor: string;
}

/**
 * Stitch-style KPI card:
 * - Background trắng (surface-container-lowest) + ambient-shadow thay vì màu nhạt
 * - Icon có "tile" riêng nhỏ (size-10 rounded-xl) dùng props.bg làm nền
 * - Value text-2xl font-bold (Stitch dùng text-3xl nhưng 2xl ăn không gian compact hơn cho 4-col grid)
 * - Trend badge pill-style (`rounded-full px-2 py-0.5`) với icon arrow ngầm định
 *
 * Props giữ nguyên 100% backward-compat để tất cả call site không phải sửa.
 */
export function KpiCard({
  label,
  value,
  change,
  positive,
  icon,
  bg,
  iconColor,
  valueColor,
}: KpiCardProps) {
  return (
    <div className="bg-surface-container-lowest rounded-xl ambient-shadow p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-muted-foreground truncate uppercase tracking-wide">
            {label}
          </p>
          <p
            className={cn(
              "text-xl lg:text-2xl font-bold mt-1.5 truncate tabular-nums",
              valueColor,
            )}
          >
            {value}
          </p>
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] mt-2 px-2 py-0.5 rounded-full font-medium",
                positive
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700",
              )}
            >
              {change}
            </span>
          )}
        </div>
        <div
          className={cn(
            "size-10 rounded-xl flex items-center justify-center shrink-0",
            bg,
          )}
        >
          <MSIcon name={icon} size={22} className={cn(iconColor)} />
        </div>
      </div>
    </div>
  );
}
