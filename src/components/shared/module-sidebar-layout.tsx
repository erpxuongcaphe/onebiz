"use client";

// ---------------------------------------------------------------------------
// ModuleSidebarLayout — sub-layout sidebar tái sử dụng
// Dùng cho các module có nhiều trang con (Cài đặt, Phân tích, Cấu hình...)
// - Desktop: sidebar trái cố định
// - Mobile: thanh tab cuộn ngang sticky dưới top-nav
// - Hỗ trợ group section
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
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
}

export interface ModuleNavGroup {
  label?: string;
  items: ModuleNavItem[];
}

interface ModuleSidebarLayoutProps {
  /** Tiêu đề hiển thị ở đầu sidebar */
  title: string;
  /** Group/items để render */
  nav: ModuleNavGroup[];
  /** Class tùy biến cho content area (vd: "max-w-4xl") */
  contentClassName?: string;
  children: React.ReactNode;
}

export function ModuleSidebarLayout({
  title,
  nav,
  contentClassName = "max-w-6xl",
  children,
}: ModuleSidebarLayoutProps) {
  const pathname = usePathname();

  const isActive = (item: ModuleNavItem) => {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  // Flatten for mobile horizontal scroll
  const flatItems = nav.flatMap((g) => g.items);

  return (
    <div className="min-h-[calc(100vh-64px)]">
      {/* Mobile horizontal tabs */}
      <div className="lg:hidden border-b bg-background sticky top-16 z-40">
        <ScrollArea className="w-full">
          <div className="flex gap-1 p-2">
            {flatItems.map((item) => {
              const active = isActive(item);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-w-[64px]",
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
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">{title}</h2>
            <nav className="space-y-4">
              {nav.map((group, gi) => (
                <div key={gi}>
                  {group.label && (
                    <div className="px-3 pb-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.label}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = isActive(item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors press-scale-sm",
                            active
                              ? "bg-primary-fixed text-primary"
                              : "text-muted-foreground hover:bg-surface-container hover:text-foreground"
                          )}
                        >
                          <Icon name={item.icon} size={18} fill={active} weight={active ? 500 : 400} className="shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className={cn("p-4 md:p-6 mx-auto", contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
