"use client";

import { ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface FilterSidebarProps {
  children: ReactNode;
  className?: string;
}

/**
 * FilterSidebar — sidebar lọc bên trái cho list page.
 *
 * Responsive:
 *   - Mobile (< md): Sheet drawer trượt từ trái, mở qua nút "Bộ lọc".
 *   - Desktop (>= md): aside cố định 240px, có nút collapse → 48px
 *     (chỉ hiện icon filter_alt + count).
 *
 * Trước đây desktop sidebar luôn 240px → tổng layout = AppSidebar 256px
 * + FilterSidebar 240px + main = 496px nav/filter cố định. Trên màn hình
 * 1366px, table chỉ còn 870px → cột "GIÁ TRỊ TỒN" bị cut off. Giờ user
 * click toggle để widen main khi cần.
 *
 * Collapsed state lưu localStorage để giữ user preference.
 */
export function FilterSidebar({ children, className }: FilterSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("filter_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("filter_sidebar_collapsed", next ? "1" : "0");
      } catch {
        /* localStorage có thể bị block */
      }
      return next;
    });
  };

  return (
    <>
      {/* Mobile filter button */}
      <Button
        variant="outline"
        size="sm"
        className="md:hidden flex items-center gap-1.5"
        onClick={() => setMobileOpen(true)}
      >
        <Icon name="filter_alt" size={16} />
        Bộ lọc
      </Button>

      {/* Mobile filter sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold">Bộ lọc</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(false)}>
              <Icon name="close" size={16} />
            </Button>
          </SheetTitle>
          <ScrollArea className="h-[calc(100vh-57px)]">
            <div className="p-4 space-y-5">{children}</div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar — collapsible */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r bg-surface-container-low overflow-y-auto transition-[width] duration-200",
          collapsed ? "w-12" : "w-[240px]",
          className,
        )}
      >
        {/* Toggle bar */}
        <div
          className={cn(
            "flex items-center border-b border-border bg-surface-container-low sticky top-0 z-10",
            collapsed ? "justify-center py-2" : "justify-between px-3 py-2",
          )}
        >
          {!collapsed && (
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Bộ lọc
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="press-scale-sm h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-foreground"
            aria-label={collapsed ? "Mở rộng bộ lọc" : "Thu gọn bộ lọc"}
            title={collapsed ? "Mở bộ lọc" : "Thu gọn bộ lọc"}
          >
            <Icon
              name={collapsed ? "filter_alt" : "left_panel_close"}
              size={16}
            />
          </button>
        </div>

        {/* Filter content (ẩn khi collapsed) */}
        {!collapsed && <div className="p-4 space-y-5">{children}</div>}
      </aside>
    </>
  );
}

interface FilterGroupProps {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}

export function FilterGroup({
  label,
  children,
  defaultOpen = true,
  action,
}: FilterGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        className="flex items-center justify-between w-full text-sm font-semibold text-foreground mb-2"
        onClick={() => setOpen(!open)}
      >
        <span>{label}</span>
        <div className="flex items-center gap-1">
          {action}
          <span className="text-muted-foreground text-xs">
            {open ? "−" : "+"}
          </span>
        </div>
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}
