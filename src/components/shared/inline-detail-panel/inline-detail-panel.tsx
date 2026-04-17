"use client";

import { ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface InlineDetailPanelProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * Inline detail panel that expands below a table row (KiotViet pattern).
 * Should be rendered inside a <TableRow> that spans all columns.
 */
export function InlineDetailPanel({
  open,
  onClose,
  children,
  className,
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="absolute right-3 top-3 z-10 rounded-md p-1 hover:bg-muted transition-colors"
        >
          <Icon name="close" size={16} className="text-muted-foreground" />
        </button>
        {children}
      </div>
    </div>
  );
}
