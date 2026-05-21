"use client";

// ---------------------------------------------------------------------------
// ModuleSidebarLayout — sub-layout sidebar tái sử dụng
// Dùng cho các module có nhiều trang con (Cài đặt, Phân tích, Cấu hình...)
// - Desktop: sidebar trái cố định
// - Mobile: thanh tab cuộn ngang sticky dưới top-nav
// - Hỗ trợ group section
// - Day 21/05/2026 (CEO): bổ sung search bar + collapsible groups
//   để menu "tinh tế, gọn gàng có thể chọn khi cần" khi có nhiều trang con
//   (vd: /phan-tich có 32 báo cáo chia 6 nhóm).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export interface ModuleNavItem {
  label: string;
  href: string;
  /** Material Symbols icon name (e.g. "dashboard", "shopping_cart") */
  icon: string;
  /** Match exact (cho trang gốc của module) */
  exact?: boolean;
  /** Optional badge text bên phải (vd "Sắp ra mắt" cho tính năng dev dở) */
  badge?: string;
}

export interface ModuleNavGroup {
  label?: string;
  items: ModuleNavItem[];
  /** Cho phép user collapse/expand nhóm này (default false = luôn mở). */
  collapsible?: boolean;
  /** Mặc định mở (true) hay đóng (false) — chỉ áp dụng khi `collapsible: true`. */
  defaultOpen?: boolean;
}

interface ModuleSidebarLayoutProps {
  /** Tiêu đề hiển thị ở đầu sidebar */
  title: string;
  /** Group/items để render */
  nav: ModuleNavGroup[];
  /** Class tùy biến cho content area (vd: "max-w-4xl") */
  contentClassName?: string;
  /**
   * Bật ô tìm kiếm trong sidebar — chỉ nên bật khi module có nhiều trang.
   * Search filter theo label (không phân biệt hoa thường, có hỗ trợ Tiếng Việt).
   */
  enableSearch?: boolean;
  /**
   * Key để persist trạng thái mở/đóng từng nhóm vào localStorage.
   * Format: `sidebar:<moduleKey>:<groupIndex>` → "1" | "0".
   */
  persistKey?: string;
  children: React.ReactNode;
}

// Bỏ dấu Tiếng Việt cho search (đ → d, óàá → o/a/a, etc.)
function stripVN(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

export function ModuleSidebarLayout({
  title,
  nav,
  contentClassName = "max-w-6xl",
  enableSearch = false,
  persistKey,
  children,
}: ModuleSidebarLayoutProps) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [openMap, setOpenMap] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    nav.forEach((g, i) => {
      init[i] = g.collapsible ? g.defaultOpen !== false : true;
    });
    return init;
  });

  // Restore open state from localStorage on mount (hydration step — safe
  // pattern: read browser-only storage sau khi component đã hydrate).
  useEffect(() => {
    if (!persistKey || typeof window === "undefined") return;
    const restored: Record<number, boolean> = {};
    nav.forEach((g, i) => {
      if (!g.collapsible) {
        restored[i] = true;
        return;
      }
      const stored = window.localStorage.getItem(`sidebar:${persistKey}:${i}`);
      restored[i] = stored === null ? g.defaultOpen !== false : stored === "1";
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMap(restored);
  }, [persistKey, nav]);

  const toggleGroup = (idx: number) => {
    setOpenMap((prev) => {
      const next = { ...prev, [idx]: !prev[idx] };
      if (persistKey && typeof window !== "undefined") {
        window.localStorage.setItem(
          `sidebar:${persistKey}:${idx}`,
          next[idx] ? "1" : "0",
        );
      }
      return next;
    });
  };

  const isActive = (item: ModuleNavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  // Filter nav by search query — strip VN diacritics for fuzzy match
  const filteredNav: ModuleNavGroup[] = useMemo(() => {
    if (!enableSearch || !search.trim()) return nav;
    const q = stripVN(search.trim());
    return nav
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => stripVN(it.label).includes(q)),
      }))
      .filter((g) => g.items.length > 0);
  }, [nav, search, enableSearch]);

  // Flatten for mobile horizontal scroll (use filtered when searching)
  const flatItems = filteredNav.flatMap((g) => g.items);

  return (
    <div className="min-h-[calc(100vh-64px)]">
      {/* Mobile horizontal tabs */}
      <div className="lg:hidden border-b bg-background sticky top-16 z-40">
        {enableSearch && (
          <div className="px-3 py-2 border-b">
            <SearchInput value={search} onChange={setSearch} />
          </div>
        )}
        <ScrollArea className="w-full">
          <div className="flex gap-1 p-1.5">
            {flatItems.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-w-[64px]",
                    active
                      ? "bg-primary-fixed text-primary"
                      : "text-muted-foreground hover:bg-surface-container hover:text-foreground"
                  )}
                >
                  <Icon name={item.icon} size={16} fill={active} weight={active ? 500 : 400} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 border-r bg-background sticky top-16 h-[calc(100vh-64px)] overflow-y-auto">
          <div className="p-3 space-y-3">
            <h2 className="text-base font-semibold">{title}</h2>
            {enableSearch && (
              <SearchInput value={search} onChange={setSearch} />
            )}
            <nav className="space-y-3">
              {filteredNav.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Không tìm thấy mục nào.
                </div>
              )}
              {filteredNav.map((group, gi) => {
                // Khi đang search → luôn mở để hiển thị kết quả
                const expanded = search.trim() ? true : openMap[gi] ?? true;
                const showChevron = group.collapsible && !search.trim();
                return (
                  <div key={gi}>
                    {group.label && (
                      <button
                        type="button"
                        onClick={() =>
                          group.collapsible ? toggleGroup(gi) : undefined
                        }
                        disabled={!group.collapsible || !!search.trim()}
                        className={cn(
                          "w-full flex items-center justify-between px-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide",
                          group.collapsible &&
                            !search.trim() &&
                            "cursor-pointer hover:text-foreground transition-colors",
                          (!group.collapsible || !!search.trim()) &&
                            "cursor-default",
                        )}
                      >
                        <span>{group.label}</span>
                        {showChevron && (
                          <Icon
                            name="expand_more"
                            size={14}
                            className={cn(
                              "transition-transform",
                              !expanded && "-rotate-90",
                            )}
                          />
                        )}
                      </button>
                    )}
                    {expanded && (
                      <div className="space-y-0.5">
                        {group.items.map((item) => {
                          const active = isActive(item);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={cn(
                                "flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors press-scale-sm",
                                active
                                  ? "bg-primary-fixed text-primary"
                                  : "text-muted-foreground hover:bg-surface-container hover:text-foreground"
                              )}
                            >
                              <Icon name={item.icon} size={16} fill={active} weight={active ? 500 : 400} className="shrink-0" />
                              <span className="truncate flex-1">{item.label}</span>
                              {item.badge && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-status-warning/10 text-status-warning font-semibold shrink-0">
                                  {item.badge}
                                </span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className={cn("p-3 md:p-5 mx-auto", contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <Icon
        name="search"
        size={16}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Tìm báo cáo…"
        className="w-full pl-8 pr-7 py-1.5 text-sm rounded-lg border bg-surface-container-low focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 size-5 rounded-full hover:bg-surface-container flex items-center justify-center"
          aria-label="Xóa tìm kiếm"
        >
          <Icon name="close" size={14} className="text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
