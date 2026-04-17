"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Globe,
  MessageCircle,
  Monitor,
  LayoutDashboard,
  ShoppingBag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/icon";

const ONLINE_NAV = [
  { href: "/ban-online", label: "Tổng quan", icon: LayoutDashboard, exact: true },
  { href: "/ban-online/facebook", label: "Facebook", icon: Globe },
  { href: "/ban-online/zalo", label: "Zalo", icon: MessageCircle },
  { href: "/ban-online/website", label: "Website", icon: Monitor },
  { href: "/ban-online/don-hang", label: "Đơn hàng", icon: ShoppingBag },
];

export default function BanOnlineLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden md:flex w-48 lg:w-52 border-r bg-white shrink-0 flex-col">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <Icon name="public" className="size-4 text-primary" />
            Bán online
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-0.5">
            {ONLINE_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.exact
                ? pathname === item.href
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </ScrollArea>
      </aside>

      {/* Mobile nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t">
        <div className="flex justify-around px-1 py-1">
          {ONLINE_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded text-[10px] transition-colors",
                  isActive ? "text-primary font-medium" : "text-gray-500"
                )}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-auto pb-16 md:pb-0">
        {children}
      </main>
    </div>
  );
}
