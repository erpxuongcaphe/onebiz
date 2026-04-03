"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  TrendingUp,
  ShoppingCart,
  Package,
  Users,
  Truck,
  Wallet,
  ClipboardList,
  Globe,
  CalendarCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

const ANALYTICS_NAV = [
  { href: "/phan-tich", label: "Tổng quan", icon: BarChart3, exact: true },
  { href: "/phan-tich/cuoi-ngay", label: "Cuối ngày", icon: CalendarCheck },
  { href: "/phan-tich/ban-hang", label: "Bán hàng", icon: TrendingUp },
  { href: "/phan-tich/hang-hoa", label: "Hàng hóa", icon: Package },
  { href: "/phan-tich/khach-hang", label: "Khách hàng", icon: Users },
  { href: "/phan-tich/nha-cung-cap", label: "Nhà cung cấp", icon: Truck },
  { href: "/phan-tich/tai-chinh", label: "Tài chính", icon: Wallet },
  { href: "/phan-tich/dat-hang", label: "Đặt hàng", icon: ClipboardList },
  { href: "/phan-tich/kenh-ban", label: "Kênh bán", icon: Globe },
];

export default function PhanTichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="hidden md:flex w-52 lg:w-56 border-r bg-white shrink-0 flex-col">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 className="size-4 text-primary" />
            Phân tích
          </h2>
        </div>
        <ScrollArea className="flex-1">
          <nav className="p-2 space-y-0.5">
            {ANALYTICS_NAV.map((item) => {
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
        <div className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-1 py-1">
          {ANALYTICS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 shrink-0 rounded text-[10px] transition-colors min-w-[60px]",
                  isActive
                    ? "text-primary font-medium"
                    : "text-gray-500"
                )}
              >
                <Icon className="size-4" />
                <span className="truncate">{item.label}</span>
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
