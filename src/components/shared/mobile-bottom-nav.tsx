"use client";

// ---------------------------------------------------------------------------
// MobileBottomNav — thanh điều hướng cố định ở đáy màn hình cho mobile
// - Hiển thị < md (< 768px), ẩn trên desktop
// - 5 tab chính: Tổng quan, Hàng hóa, POS (nổi bật), Đơn hàng, Thêm
// - Auto-highlight theo pathname
// - "Thêm" mở Sheet với các menu phụ
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ClipboardList,
  MoreHorizontal,
  Users,
  LineChart,
  Wallet,
  Settings,
  Globe,
  Bell,
  Factory,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface TabItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  match?: (pathname: string) => boolean;
}

const PRIMARY_TABS: TabItem[] = [
  {
    label: "Tổng quan",
    href: "/",
    icon: LayoutDashboard,
    match: (p) => p === "/",
  },
  {
    label: "Hàng hóa",
    href: "/hang-hoa",
    icon: Package,
    match: (p) => p.startsWith("/hang-hoa"),
  },
  // POS nổi ở giữa
  {
    label: "Bán hàng",
    href: "/pos",
    icon: ShoppingCart,
    match: (p) => p.startsWith("/pos"),
  },
  {
    label: "Đơn hàng",
    href: "/don-hang/hoa-don",
    icon: ClipboardList,
    match: (p) => p.startsWith("/don-hang"),
  },
];

const MORE_ITEMS: {
  section: string;
  items: { label: string; href: string; icon: typeof LayoutDashboard }[];
}[] = [
  {
    section: "Quản lý",
    items: [
      { label: "Khách hàng", href: "/khach-hang", icon: Users },
      { label: "Sổ quỹ", href: "/so-quy", icon: Wallet },
      { label: "Phân tích", href: "/phan-tich", icon: LineChart },
      { label: "Bán online", href: "/ban-online", icon: Globe },
    ],
  },
  {
    section: "Sản xuất",
    items: [
      { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat", icon: Factory },
      { label: "Công thức (BOM)", href: "/hang-hoa/cong-thuc", icon: ClipboardList },
      { label: "Hạn sử dụng", href: "/hang-hoa/hsd", icon: Bell },
    ],
  },
  {
    section: "Khác",
    items: [
      { label: "Thông báo", href: "/thong-bao", icon: Bell },
      { label: "Cài đặt", href: "/cai-dat", icon: Settings },
    ],
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  // Ẩn trên trang POS (toàn màn hình)
  if (pathname.startsWith("/pos")) return null;
  // Ẩn trên trang login
  if (pathname.startsWith("/dang-nhap") || pathname.startsWith("/quen-mat-khau")) {
    return null;
  }

  return (
    <>
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background border-t shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <nav className="flex items-stretch justify-around h-14">
          {PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = tab.match ? tab.match(pathname) : pathname === tab.href;
            const isB2B = tab.href === "/pos";

            if (isB2B) {
              return (
                <div
                  key={tab.href}
                  className="relative flex items-center justify-center w-16"
                >
                  <Link
                    href={tab.href}
                    className="absolute -top-5 flex flex-col items-center justify-center h-14 w-14 rounded-full bg-emerald-600 text-white shadow-lg active:scale-95 transition-transform"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[9px] font-semibold leading-tight mt-0.5">
                      Bán
                    </span>
                  </Link>
                </div>
              );
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-col items-center justify-center flex-1 gap-0.5 transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger className="flex flex-col items-center justify-center flex-1 gap-0.5 text-muted-foreground hover:text-foreground transition-colors">
              <MoreHorizontal className="h-5 w-5" />
              <span className="text-[10px] font-medium">Thêm</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[70vh] p-0 rounded-t-xl">
              <SheetTitle className="px-4 py-3 border-b">Menu</SheetTitle>
              <div className="overflow-y-auto h-[calc(70vh-52px)] p-3 space-y-4">
                {MORE_ITEMS.map((section) => (
                  <div key={section.section}>
                    <div className="px-1 pb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      {section.section}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {section.items.map((item) => {
                        const Icon = item.icon;
                        const active = pathname.startsWith(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className={cn(
                              "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors",
                              active
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "hover:bg-muted border-transparent"
                            )}
                          >
                            <Icon className="h-5 w-5" />
                            <span className="text-[11px] font-medium text-center leading-tight">
                              {item.label}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      </div>
      {/* Spacer để content không bị che bởi bottom nav */}
      <div
        className="md:hidden h-14"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-hidden
      />
    </>
  );
}
