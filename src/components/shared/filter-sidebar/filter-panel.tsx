"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "left" : "bottom"}
        className={
          desktop
            ? "w-[360px] max-w-[min(360px,90vw)] gap-0 p-0"
            : "max-h-[85dvh] gap-0 rounded-t-lg p-0"
        }
      >
        <SheetHeader className="flex-row items-center justify-between border-b px-4 py-3 pr-14">
          <SheetTitle className="flex items-center gap-2">
            <Icon name="filter_alt" size={17} />
            {title}
            {activeCount > 0 && (
              <span className="rounded-full bg-primary-fixed px-2 py-0.5 text-[11px] font-semibold text-primary">
                {activeCount}
              </span>
            )}
          </SheetTitle>
          {onClearAll && activeCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="h-8 text-xs text-muted-foreground hover:text-destructive"
            >
              Xóa tất cả
            </Button>
          )}
        </SheetHeader>
        <ScrollArea className={desktop ? "h-[calc(100dvh-3.25rem)]" : "max-h-[calc(85dvh-3.25rem)]"}>
          <div className="space-y-2 p-4">{children}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

