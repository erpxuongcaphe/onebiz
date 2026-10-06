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
        "flex flex-col gap-1 border-b bg-surface-container-lowest px-3 py-2 md:h-12 md:min-h-12 md:flex-row md:items-center md:gap-2 md:py-0",
        className,
      )}
    >
      <div className="grid w-full min-w-0 grid-cols-2 gap-x-2 gap-y-1 md:flex md:flex-1 md:items-center md:gap-1.5 md:overflow-x-auto md:whitespace-nowrap">
        {metrics}
      </div>
      {tools && (
        <div className="flex shrink-0 items-center justify-end gap-1.5">{tools}</div>
      )}
    </section>
  );
}
