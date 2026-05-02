"use client";

import { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Tên Material Symbols icon. Default `inbox`. */
  icon?: string;
  /** Tiêu đề chính, vd "Chưa có hàng hóa nào", "Không tìm thấy kết quả". */
  title: string;
  /** Mô tả phụ — gợi ý hành động tiếp theo. */
  description?: string;
  /** Slot action button — vd `<Button>Tạo mới</Button>`. */
  action?: ReactNode;
  /** Tone visual — `default` xám, `info` xanh nhạt, `warning` vàng. */
  tone?: "default" | "info" | "warning" | "error";
  /** Padding compact cho empty state trong ô nhỏ (vd inside card). */
  compact?: boolean;
  className?: string;
}

/**
 * EmptyState — UI chuẩn cho tình huống "không có dữ liệu".
 *
 * Sprint POLISH-4: extract từ 50+ ad-hoc empty rendering rải rác trong
 * list pages (`<div className="text-center text-muted-foreground py-12">
 * <Icon ... /> ...`). Mỗi page tự design → inconsistent.
 *
 * Pattern Stitch: icon trong ring tròn `bg-primary-fixed`, title font-medium,
 * description xs, action ở dưới. Compact mode bỏ ring + giảm padding cho
 * dùng trong card nhỏ.
 *
 * ```tsx
 * <EmptyState
 *   icon="inventory_2"
 *   title="Chưa có hàng hóa nào"
 *   description="Bấm 'Tạo mới' để thêm sản phẩm đầu tiên."
 *   action={<Button>Tạo mới</Button>}
 * />
 * ```
 */
export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
  tone = "default",
  compact = false,
  className,
}: EmptyStateProps) {
  const ringClass =
    tone === "info"
      ? "bg-primary-fixed text-primary"
      : tone === "warning"
        ? "bg-status-warning/15 text-status-warning"
        : tone === "error"
          ? "bg-destructive/10 text-destructive"
          : "bg-muted text-muted-foreground";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "py-6 gap-2" : "py-12 gap-3",
        className,
      )}
    >
      <div
        className={cn(
          "rounded-full flex items-center justify-center",
          compact ? "h-12 w-12" : "h-16 w-16",
          ringClass,
        )}
      >
        <Icon name={icon} size={compact ? 22 : 28} />
      </div>
      <div className="space-y-1 max-w-sm px-4">
        <p className={cn("font-medium text-foreground", compact ? "text-sm" : "text-base")}>
          {title}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
