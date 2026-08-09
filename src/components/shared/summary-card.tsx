"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";

interface SummaryCardProps {
  icon?: ReactNode | string;
  label: string;
  value: string;
  hint?: string;
  count?: number;
  highlight?: boolean;
  danger?: boolean;
  tone?: "default" | "success" | "warning" | "error";
  className?: string;
  valueClassName?: string;
  loading?: boolean;
  /** Khi có onClick, thẻ trở thành nút lọc có hỗ trợ bàn phím. */
  onClick?: () => void;
  /** Trạng thái bộ lọc hiện đang được áp dụng. */
  selected?: boolean;
  ariaLabel?: string;
}

/** Thẻ chỉ số gọn dùng ở đầu các trang danh sách. */
export function SummaryCard({
  icon,
  label,
  value,
  hint,
  count,
  highlight,
  danger,
  tone,
  className,
  valueClassName,
  loading,
  onClick,
  selected,
  ariaLabel,
}: SummaryCardProps) {
  const iconNode =
    typeof icon === "string" ? (
      <Icon name={icon} size={14} className="text-muted-foreground" />
    ) : (
      icon
    );

  const isHighlight = highlight || tone === "success";
  const isDanger = danger || tone === "error";
  const isWarning = tone === "warning";
  const cardClassName = cn(
    "border rounded-lg p-2 sm:p-2.5 bg-white border-l-2 transition-colors min-w-0",
    !isHighlight && !isDanger && !isWarning && "border-border border-l-primary/40",
    isHighlight && "border-primary/30 border-l-primary bg-primary/5",
    isDanger && "border-destructive/30 border-l-destructive bg-destructive/5",
    isWarning && "border-status-warning/30 border-l-status-warning bg-status-warning/5",
    onClick &&
      "w-full text-left cursor-pointer hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
    selected && "border-primary bg-primary/5 ring-2 ring-primary/20",
    className,
  );

  const content = (
    <>
      <div className="flex items-center gap-2 text-[11px] sm:text-xs text-muted-foreground mb-0.5">
        {iconNode}
        <span className="truncate">{label}</span>
        {typeof count === "number" && (
          <span className="ml-auto text-[11px] sm:text-xs font-medium text-muted-foreground tabular-nums">
            {formatNumber(count)}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-5 sm:h-6 w-16 bg-muted/60 rounded animate-pulse my-1" />
      ) : (
        <div
          className={cn(
            "text-base sm:text-lg font-bold tabular-nums truncate",
            isHighlight && "text-primary",
            isDanger && "text-destructive",
            isWarning && "text-status-warning",
            !isHighlight && !isDanger && !isWarning && "text-foreground",
            valueClassName,
          )}
        >
          {value}
        </div>
      )}
      {hint && !loading && (
        <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">
          {hint}
        </div>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cardClassName}
        onClick={onClick}
        disabled={loading}
        aria-pressed={selected}
        aria-label={ariaLabel ?? `${label}: ${value}`}
      >
        {content}
      </button>
    );
  }

  return <div className={cardClassName}>{content}</div>;
}
