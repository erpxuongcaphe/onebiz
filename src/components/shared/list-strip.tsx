"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ListStripProps {
  metrics?: ReactNode;
  tools?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

/**
 * Dải gọn nằm ngay trên bảng: chỉ số ở trái, công cụ ở phải.
 * Nội dung tự cuộn ngang trên màn hẹp để không đẩy bảng xuống thêm hàng.
 */
export function ListStrip({
  metrics,
  tools,
  className,
  ariaLabel = "Chỉ số và công cụ danh sách",
}: ListStripProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "flex h-12 min-h-12 items-center gap-2 border-b bg-surface-container-lowest px-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap no-scrollbar">
        {metrics}
      </div>
      {tools && (
        <div className="flex shrink-0 items-center gap-1.5">{tools}</div>
      )}
    </section>
  );
}
