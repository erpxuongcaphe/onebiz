"use client";

import type { ReactNode } from "react";
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
  /**
   * Dòng phụ tùy chọn hiển thị ngay dưới value (vd tách "Hàng hóa · Phí giao").
   * Optional để 100% backward-compat với mọi call site cũ.
   */
  subValue?: ReactNode;
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
  subValue,
}: KpiCardProps) {
  const numericValue = /\d/.test(value);
  const valueSizeClass =
    value.length >= 22
      ? "text-sm leading-5"
      : value.length >= 17
        ? "text-base leading-6"
        : value.length >= 13
          ? "text-lg leading-6"
          : "text-xl leading-7 lg:text-2xl";

  return (
    <div className="bg-surface-container-lowest rounded-lg ambient-shadow p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-4 text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "mt-2 max-w-full font-bold tabular-nums",
              numericValue ? "whitespace-nowrap" : "break-words",
              valueSizeClass,
              valueColor,
            )}
          >
            {value}
          </p>
          {subValue && (
            <div className="mt-1 text-[11px] text-muted-foreground">{subValue}</div>
          )}
          {change && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs mt-2 px-2 py-0.5 rounded-full font-medium",
                positive
                  ? "bg-status-success/10 text-status-success"
                  : "bg-status-error/10 text-status-error",
              )}
            >
              <MSIcon
                name={positive ? "trending_up" : "trending_down"}
                size={14}
              />
              {change}
            </span>
          )}
        </div>
        <div
          className={cn(
            "size-10 shrink-0 rounded-lg flex items-center justify-center",
            bg,
          )}
        >
          <MSIcon name={icon} size={24} className={cn(iconColor)} />
        </div>
      </div>
    </div>
  );
}
