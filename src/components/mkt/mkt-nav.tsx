"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import type { MktContext } from "@/lib/mkt/context";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Hiện với mọi người có mkt.view khi undefined; nếu có, chỉ hiện khi cờ = true */
  requires?: keyof MktContext;
  /** Hiện trên bottom-tabs mobile (không gian hẹp, chỉ mục cốt lõi) */
  mobile?: boolean;
};

// Danh sách đầy đủ theo prototype. Sidebar desktop hiện tất cả; bottom-tabs
// mobile chỉ hiện các mục cốt lõi (mobile:true) cho gọn.
const NAV_ITEMS: NavItem[] = [
  { href: "/mkt", label: "Tổng quan", icon: "dashboard", mobile: true },
  { href: "/mkt/tasks", label: "Việc của tôi", icon: "checklist", mobile: true },
  { href: "/mkt/campaigns", label: "Chiến dịch", icon: "campaign", mobile: true },
  { href: "/mkt/kanban", label: "Kanban", icon: "view_kanban" },
  { href: "/mkt/calendar", label: "Lịch", icon: "calendar_month" },
  { href: "/mkt/approvals", label: "Duyệt nội dung", icon: "rate_review", requires: "canReview", mobile: true },
  { href: "/mkt/leader-queue", label: "Cần Leader xử lý", icon: "manage_accounts", requires: "isLead" },
  { href: "/mkt/team", label: "Nhân sự", icon: "groups", requires: "isLead" },
  { href: "/mkt/media", label: "Thư viện", icon: "photo_library" },
  { href: "/mkt/reports", label: "Báo cáo", icon: "bar_chart" },
  { href: "/mkt/settings", label: "Cài đặt", icon: "settings", mobile: true },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/mkt") return pathname === "/mkt";
  return pathname === href || pathname.startsWith(href + "/");
}

export function MktNav({ ctx }: { ctx: MktContext }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.requires || ctx[item.requires]);

  return (
    <>
      {/* Sidebar desktop */}
      <nav className="hidden w-56 shrink-0 border-r border-outline-variant bg-background p-3 lg:block">
        <ul className="space-y-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium " +
                    (active
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface-variant hover:bg-surface-container")
                  }
                >
                  <Icon name={item.icon} size={20} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Bottom tabs mobile — chỉ mục cốt lõi cho gọn */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-outline-variant bg-background lg:hidden">
        {items
          .filter((item) => item.mobile)
          .map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium " +
                (active ? "text-primary" : "text-on-surface-variant")
              }
            >
              <Icon name={item.icon} size={22} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
