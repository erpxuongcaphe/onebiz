"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBreakpoint } from "@/lib/hooks/use-breakpoint";

interface FilterPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  activeCount?: number;
  onClearAll?: () => void;
  title?: string;
}

/** Panel lọc phủ lên nội dung; không chiếm bề ngang bảng và không có nút Áp dụng. */
export function FilterPanel({
  open,
  onOpenChange,
  children,
  activeCount = 0,
  onClearAll,
  title = "Bộ lọc",
}: FilterPanelProps) {
  const desktop = useBreakpoint("md");

  return (
    <Sheet open={open} onOpenChange={onOpenChange} protectUnsavedChanges={false}>
      <SheetContent
        side={desktop ? "left" : "bottom"}
        showCloseButton={false}
        className={
          desktop
            ? "data-[side=left]:w-[400px] data-[side=left]:sm:max-w-[400px] gap-0 overflow-hidden p-0 shadow-xl"
            : "max-h-[90dvh] gap-0 overflow-hidden rounded-t-lg p-0 shadow-xl"
        }
      >
        <SheetHeader className="shrink-0 flex-row items-center justify-between gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3">
          <SheetTitle className="flex min-w-0 items-center gap-2 pr-0 text-base text-foreground">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon name="filter_alt" size={18} /></span>
            <span className="min-w-0 break-words">{title}</span>
            {activeCount > 0 && (
              <span aria-label={`${activeCount} điều kiện đang lọc`} className="shrink-0 rounded-md border border-primary/20 bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                {activeCount}
              </span>
            )}
          </SheetTitle>
          <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Đóng bộ lọc" title="Đóng bộ lọc" onClick={() => onOpenChange(false)}><Icon name="close" size={20} /></Button>
        </SheetHeader>
        <div data-testid="filter-scroll-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background [scrollbar-gutter:stable]">
          <div className="space-y-4 p-4">{children}</div>
        </div>
        <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {onClearAll && activeCount > 0 && <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onClearAll}><Icon name="filter_alt_off" size={17} />Xóa tất cả</Button>}
          <Button type="button" className="h-11 min-w-0 flex-1" onClick={() => onOpenChange(false)}><Icon name="check" size={17}/>Xem kết quả</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
