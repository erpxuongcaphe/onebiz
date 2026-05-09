"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/icon";
import { DemoNotice } from "@/components/shared/demo-notice";

const ONLINE_NAV = [
  { href: "/ban-online", label: "Tổng quan", icon: "dashboard", exact: true },
  { href: "/ban-online/facebook", label: "Facebook", icon: "public" },
  { href: "/ban-online/zalo", label: "Zalo", icon: "forum" },
  { href: "/ban-online/website", label: "Website", icon: "desktop_windows" },
  { href: "/ban-online/don-hang", label: "Đơn hàng", icon: "shopping_bag" },
];

export default function BanOnlineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="hidden md:flex w-48 lg:w-52 border-r bg-surface-container-lowest shrink-0 flex-col">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Icon name="public" className="size-4 text-primary" />
            Bán online
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-0.5">
            {ONLINE_NAV.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon name={item.icon} size={16} fill={isActive} className="shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* Mobile nav */}
      <div className="sticky top-0 z-30 border-b bg-surface-container-lowest/95 backdrop-blur md:hidden">
        <div className="flex gap-1 overflow-x-auto px-3 py-2">
          {ONLINE_NAV.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-w-[72px] flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[10px] transition-colors",
                  isActive
                    ? "bg-primary-fixed text-primary font-semibold"
                    : "text-muted-foreground"
                )}
              >
                <Icon name={item.icon} size={16} fill={isActive} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-auto pb-3 md:pb-0">
        {/* Banner toàn module: KPI/conversation/order ở /ban-online/* hiện
            là dữ liệu mẫu. Sẽ thay khi tích hợp Facebook/Zalo/Web. */}
        <div className="px-4 pt-3 md:px-6 md:pt-4">
          <DemoNotice
            title="Module Bán online — đang phát triển"
            description="Số liệu, hội thoại và đơn hàng trên các trang con (Facebook, Zalo, Website, Đơn hàng online) đang là dữ liệu mẫu để xem trước giao diện. Khi tích hợp xong API các kênh, dữ liệu sẽ tự động cập nhật từ DB."
          />
        </div>
        {children}
      </main>
    </div>
  );
}
