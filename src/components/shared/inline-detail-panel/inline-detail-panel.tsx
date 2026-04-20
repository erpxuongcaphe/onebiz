"use client";

import { ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface InlineDetailPanelProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Hiện nút "Sửa" ở góc phải trên, ngay cạnh nút đóng. */
  onEdit?: () => void;
  /** Hiện nút "Xóa" ở góc phải trên (destructive). */
  onDelete?: () => void;
  /** Label tùy chỉnh cho nút Sửa (mặc định "Sửa"). */
  editLabel?: string;
  /** Label tùy chỉnh cho nút Xóa (mặc định "Xóa"). */
  deleteLabel?: string;
}

/**
 * Inline detail panel that expands below a table row (KiotViet pattern).
 * Should be rendered inside a <TableRow> that spans all columns.
 *
 * Khi truyền onEdit/onDelete, panel hiện action buttons ở header để user
 * sửa/xóa nhanh mà không phải đóng panel rồi click menu 3 chấm.
 */
export function InlineDetailPanel({
  open,
  onClose,
  children,
  className,
  onEdit,
  onDelete,
  editLabel = "Sửa",
  deleteLabel = "Xóa",
}: InlineDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        // Stitch style: dùng surface-container-low (xám nhạt) để panel nổi trên
        // row trắng, border primary-fixed thay vì blue-200 cứng.
        "border-t border-b border-primary-fixed bg-surface-container-low",
        "animate-in slide-in-from-top-2 fade-in-0 duration-200",
        className
      )}
    >
      <div className="relative">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          {onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-outline-variant bg-surface px-2.5 py-1 text-[12px] font-medium text-on-surface hover:bg-surface-container-high transition-colors"
              aria-label={editLabel}
            >
              <Icon name="edit" size={14} />
              <span>{editLabel}</span>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-error/30 bg-error-container/40 px-2.5 py-1 text-[12px] font-medium text-error hover:bg-error-container/70 transition-colors"
              aria-label={deleteLabel}
            >
              <Icon name="delete" size={14} />
              <span>{deleteLabel}</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="rounded-md p-1 hover:bg-muted transition-colors"
            aria-label="Đóng"
          >
            <Icon name="close" size={16} className="text-muted-foreground" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
