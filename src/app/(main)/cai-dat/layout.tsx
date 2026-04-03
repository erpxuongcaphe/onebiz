"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Store,
  ShoppingCart,
  Printer,
  GitBranch,
  FileText,
  Shield,
  Truck,
  Bell,
  Globe,
  Palette,
  CreditCard,
  Tag,
  Star,
  DollarSign,
  Link2,
} from "lucide-react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";

const settingsNav = [
  { label: "Cửa hàng", href: "/cai-dat", icon: Store },
  { label: "Bán hàng", href: "/cai-dat/ban-hang", icon: ShoppingCart },
  { label: "In ấn", href: "/cai-dat/in-an", icon: Printer },
  { label: "Chi nhánh", href: "/cai-dat/chi-nhanh", icon: GitBranch },
  { label: "Hóa đơn", href: "/cai-dat/hoa-don", icon: FileText },
  { label: "Phân quyền", href: "/cai-dat/phan-quyen", icon: Shield },
  { label: "Giao hàng", href: "/cai-dat/giao-hang", icon: Truck },
  { label: "Thông báo", href: "/cai-dat/thong-bao", icon: Bell },
  { label: "Thanh toán", href: "/cai-dat/thanh-toan", icon: CreditCard },
  { label: "Ngôn ngữ", href: "/cai-dat/ngon-ngu", icon: Globe },
  { label: "Giao diện", href: "/cai-dat/giao-dien", icon: Palette },
  { label: "Khuyến mãi", href: "/cai-dat/khuyen-mai", icon: Tag },
  { label: "Tích điểm", href: "/cai-dat/tich-diem", icon: Star },
  { label: "Bảng giá", href: "/cai-dat/bang-gia", icon: DollarSign },
  { label: "Kết nối", href: "/cai-dat/ket-noi", icon: Link2 },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/cai-dat") return pathname === "/cai-dat";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <div className="min-h-[calc(100vh-48px)]">
      {/* Mobile: horizontal scrollable tabs */}
      <div className="lg:hidden border-b bg-background sticky top-12 z-40">
        <ScrollArea className="w-full">
          <div className="flex gap-1 p-2">
            {settingsNav.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-colors min-w-[64px]",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      <div className="flex">
        {/* Desktop: fixed left sidebar */}
        <aside className="hidden lg:block w-60 shrink-0 border-r bg-background sticky top-12 h-[calc(100vh-48px)] overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4">Cài đặt</h2>
            <nav className="space-y-1">
              {settingsNav.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="p-4 md:p-6 max-w-4xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
