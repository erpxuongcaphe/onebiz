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
 * Sprint UX redesign (long-term solution, không cần migrate page nào):
 *
 * Desktop (>= md = 768px):
 *   - Width 200px khi mở (down từ 240px → save 40px cho main content).
 *   - Width 48px khi collapsed (toggle button vẫn hiện).
 *   - Padding `p-3 space-y-2` (down từ `p-4 space-y-5` → tighter density).
 *   - Sticky header "BỘ LỌC" với toggle button.
 *
 * Mobile (< md):
 *   - Sheet drawer 320px trượt từ trái khi click "Bộ lọc" button.
 *   - Sheet trigger button ẩn trên md+ (`md:hidden`).
 *
 * Tablet (768-1023):
 *   - Cùng pattern desktop. Sidebar 200px → main content được rộng hơn.
 *
 * Persist: collapsed state lưu localStorage `filter_sidebar_collapsed`
 * → user mở/thu lần sau giữ nguyên.
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
        /* localStorage có thể bị block (private mode) */
      }
      return next;
    });
  };

  return (
    <>
      {/* Mobile filter button — chỉ hiện trên mobile (< md) */}
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
        <SheetContent side="left" className="w-[320px] p-0 sm:w-[360px]">
          <SheetTitle className="flex items-center justify-between px-4 py-3 border-b">
            <span className="font-semibold">Bộ lọc</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMobileOpen(false)}
            >
              <Icon name="close" size={16} />
            </Button>
          </SheetTitle>
          <ScrollArea className="h-[calc(100vh-57px)]">
            <div className="p-4 space-y-3">{children}</div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar — collapsible 200px ↔ 48px */}
      <aside
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r bg-surface-container-low overflow-y-auto transition-[width] duration-200",
          collapsed ? "w-12" : "w-[200px]",
          className,
        )}
      >
        {/* Sticky toggle bar */}
        <div
          className={cn(
            "flex items-center border-b border-border bg-surface-container-low sticky top-0 z-10",
            collapsed ? "justify-center py-2" : "justify-between px-3 py-2",
          )}
        >
          {!collapsed && (
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Bộ lọc
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="press-scale-sm h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-surface-container hover:text-foreground"
            aria-label={collapsed ? "Mở rộng bộ lọc" : "Thu gọn bộ lọc"}
            title={collapsed ? "Mở bộ lọc" : "Thu gọn bộ lọc"}
          >
            <Icon
              name={collapsed ? "filter_alt" : "left_panel_close"}
              size={14}
            />
          </button>
        </div>

        {/* Filter content (ẩn khi collapsed) — tighter spacing */}
        {!collapsed && <div className="p-3 space-y-2">{children}</div>}
      </aside>
    </>
  );
}

interface FilterGroupProps {
  label: string;
  children: ReactNode;
  /** Default state: open (true) hoặc closed (false). Mặc định mở. */
  defaultOpen?: boolean;
  /** Action button hiển thị bên phải label (vd: "Tạo mới"). */
  action?: ReactNode;
  /**
   * Hint hiển thị bên phải khi đóng — vd "(3 chọn)" cho user biết
   * group này có active value mà không cần mở ra.
   */
  activeHint?: string;
}

/**
 * FilterGroup — collapsible section trong FilterSidebar.
 *
 * Sprint UX cải thiện:
 *   - Header là button rõ ràng với chevron rotate (consistent với
 *     AppSidebar SubGroup accordion).
 *   - Khi closed: hiện activeHint nếu có ("3 chọn", "đã lọc", v.v.)
 *     → user thấy ngay group nào đang có active filter.
 *   - Tighter padding + smaller text → gọn cho sidebar 200px.
 *   - Border-bottom subtle giữa các group → visual separator clear.
 */
export function FilterGroup({
  label,
  children,
  defaultOpen = true,
  action,
  activeHint,
}: FilterGroupProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasActive = !!activeHint;

  return (
    <div className="border-b border-border/40 last:border-b-0 pb-2 last:pb-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full press-scale-sm flex items-center justify-between gap-2 py-1.5 text-xs font-semibold transition-colors",
          hasActive ? "text-primary" : "text-foreground hover:text-primary",
        )}
      >
        <span className="flex items-center gap-1.5 truncate">
          <span className="truncate">{label}</span>
          {hasActive && !open && (
            <span className="text-[10px] font-medium text-primary bg-primary-fixed px-1.5 py-0.5 rounded-full">
              {activeHint}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {action}
          <Icon
            name="expand_more"
            size={14}
            className={cn(
              "transition-transform duration-150 text-muted-foreground",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        </span>
      </button>
      {open && <div className="mt-1.5 space-y-1 stitch-fade-in">{children}</div>}
    </div>
  );
}
