"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SummaryCardProps {
  /** Material Symbols icon (hoặc bất kỳ ReactNode nào) hiển thị bên trái label */
  icon?: ReactNode;
  /** Nhãn mô tả, thường viết tắt (ví dụ "Tổng SP", "Đang SX", ...) */
  label: string;
  /** Giá trị chính — đã format sẵn (formatCurrency, formatDate, ...) */
  value: string;
  /** Mô tả phụ nhỏ bên dưới value (ví dụ "vs tháng trước", "còn hiệu lực"...) */
  hint?: string;
  /** Viền + nền primary — dùng cho KPI tổng quan */
  highlight?: boolean;
  /** Viền + nền destructive — dùng cho cảnh báo low stock, quá hạn... */
  danger?: boolean;
  className?: string;
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
  highlight,
  danger,
  className,
}: SummaryCardProps) {
  return (
    <div
      className={cn(
        "border rounded-lg p-3 bg-background",
        highlight && "border-primary/30 bg-primary/5",
        danger && "border-destructive/30 bg-destructive/5",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "text-lg font-semibold",
          highlight && "text-primary",
          danger && "text-destructive",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
