"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";

interface SummaryCardProps {
  /**
   * Icon hiển thị bên trái label.
   * - String: tên Material Symbols (vd "group") → tự wrap `<Icon name=... size=14 />`
   * - ReactNode: render trực tiếp (vd `<Icon name="x" className="text-status-error" />`)
   */
  icon?: ReactNode | string;
  /** Nhãn mô tả, thường viết tắt (ví dụ "Tổng SP", "Đang SX", ...) */
  label: string;
  /** Giá trị chính — đã format sẵn (formatCurrency, formatDate, ...) */
  value: string;
  /** Mô tả phụ nhỏ bên dưới value (ví dụ "vs tháng trước", "còn hiệu lực"...) */
  hint?: string;
  /** Đếm số entity (cộng vào label, vd "Người dùng (5)") */
  count?: number;
  /** Viền + nền primary — dùng cho KPI tổng quan */
  highlight?: boolean;
  /** Viền + nền destructive — dùng cho cảnh báo low stock, quá hạn... */
  danger?: boolean;
  /** Tone semantic — alias quick cho highlight/danger */
  tone?: "default" | "success" | "warning" | "error";
  className?: string;
  /** Override màu cho value — dùng khi cần color phụ (vd: lệch tăng = success, lệch giảm = error). */
  valueClassName?: string;
}

/**
 * SummaryCard — KPI card compact dùng ở đầu trang list (trên DataTable).
 * Extracted từ `hang-hoa/ton-kho/page.tsx` để tái sử dụng cho các page kho
 * khác (san-xuat, chuyen-kho, ...) theo Sprint KHO-3.
 *
 * Khác với `KpiCard` trong `phan-tich/_components` — phiên bản này compact
 * hơn, không có trend badge, tối ưu cho grid 3-4 cột trên list page.
 */
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
}: SummaryCardProps) {
  // Auto-wrap string icon thành <Icon /> component.
  // Bug từng có: caller pass `icon="group"` → render text "group" thay vì
  // icon Material Symbols → label kéo "group Tổng người dùng" xấu xí.
  const iconNode =
    typeof icon === "string" ? (
      <Icon name={icon} size={14} className="text-muted-foreground" />
    ) : (
      icon
    );

  // Tone alias → highlight/danger flags
  const isHighlight = highlight || tone === "success";
  const isDanger = danger || tone === "error";
  const isWarning = tone === "warning";

  return (
    <div
      className={cn(
        "border rounded-lg p-3 bg-background",
        isHighlight && "border-primary/30 bg-primary/5",
        isDanger && "border-destructive/30 bg-destructive/5",
        isWarning && "border-status-warning/30 bg-status-warning/5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {iconNode}
        <span className="truncate">{label}</span>
        {typeof count === "number" && (
          <span className="ml-auto text-[10px] font-medium text-muted-foreground tabular-nums">
            {formatNumber(count)}
          </span>
        )}
      </div>
      <div
        className={cn(
          "text-lg font-semibold",
          isHighlight && "text-primary",
          isDanger && "text-destructive",
          isWarning && "text-status-warning",
          valueClassName,
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
