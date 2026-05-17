"use client";

// ---------------------------------------------------------------------------
// MobileBottomNav — thanh điều hướng cố định ở đáy màn hình cho mobile
// - Hiển thị < md (< 768px), ẩn trên desktop
// - 5 tab chính: Tổng quan, Hàng hóa, POS (nổi bật), Đơn hàng, Thêm
// - Auto-highlight theo pathname
// - "Thêm" mở Sheet với các menu phụ
// - Icons migrated to Material Symbols (string names)
// ---------------------------------------------------------------------------

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";

interface TabItem {
  label: string;
  href: string;
  icon: string;
  match?: (pathname: string) => boolean;
}

const PRIMARY_TABS: TabItem[] = [
  {
    label: "Tổng quan",
    href: "/",
    icon: "dashboard",
    match: (p) => p === "/",
  },
  {
    label: "Kho",
    href: "/hang-hoa/ton-kho",
    icon: "warehouse",
    match: (p) => p.startsWith("/hang-hoa"),
  },
  // POS nổi ở giữa, mở sheet chọn đúng chế độ bán.
  {
    label: "POS",
    href: "/pos",
    icon: "point_of_sale",
    match: (p) => p.startsWith("/pos"),
  },
  {
    label: "Đơn hàng",
    href: "/don-hang/hoa-don",
    icon: "receipt_long",
    match: (p) => p.startsWith("/don-hang"),
  },
];

const MORE_ITEMS: {
  section: string;
  items: { label: string; href: string; icon: string }[];
}[] = [
  {
    section: "Vận hành",
    items: [
      { label: "Sản phẩm", href: "/hang-hoa", icon: "inventory_2" },
      { label: "Khách hàng", href: "/khach-hang", icon: "group" },
      { label: "Mua hàng", href: "/hang-hoa/dat-hang-nhap", icon: "add_box" },
      // Day 4 16/05/2026: ẩn "Bán online" — mock data
      // { label: "Bán online", href: "/ban-online", icon: "public" },
    ],
  },
  {
    section: "Kho & sản xuất",
    items: [
      { label: "Kiểm kho", href: "/hang-hoa/kiem-kho", icon: "fact_check" },
      { label: "Chuyển kho", href: "/hang-hoa/chuyen-kho", icon: "swap_horiz" },
      { label: "Lệnh sản xuất", href: "/hang-hoa/san-xuat", icon: "factory" },
      { label: "Hạn sử dụng", href: "/hang-hoa/hsd", icon: "notifications" },
    ],
  },
  {
    section: "Phân tích & hệ thống",
    items: [
      { label: "Báo cáo", href: "/phan-tich", icon: "analytics" },
      { label: "Sổ quỹ", href: "/so-quy", icon: "payments" },
      { label: "Thông báo", href: "/thong-bao", icon: "notifications" },
      { label: "Cài đặt", href: "/cai-dat", icon: "settings" },
    ],
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const { posFnbUrl } = useFnbSubdomain();

  // Ẩn trên trang POS (toàn màn hình)
  if (pathname.startsWith("/pos")) return null;
  // Ẩn trên trang login
  if (pathname.startsWith("/dang-nhap") || pathname.startsWith("/quen-mat-khau")) {
    return null;
  }

  return (
    <>
      <div
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface-container-lowest/95 backdrop-blur-md border-t border-border"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <nav className="flex items-stretch justify-around h-16">
          {PRIMARY_TABS.map((tab) => {
            const active = tab.match ? tab.match(pathname) : pathname === tab.href;
            const isB2B = tab.href === "/pos";

            if (isB2B) {
              return (
                <div
                  key={tab.href}
                  className="relative flex items-center justify-center w-16"
                >
                  <Sheet open={posOpen} onOpenChange={setPosOpen}>
                    <SheetTrigger className="absolute -top-5 press-scale flex h-14 w-14 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground ambient-shadow-lg">
                      <Icon name={tab.icon} size={24} fill />
                      <span className="mt-0.5 text-[9px] font-semibold leading-tight">
                        POS
                      </span>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="p-0 rounded-t-lg" showCloseButton={false}>
                      <SheetTitle className="px-5 py-4 border-b font-semibold">Chọn chế độ POS</SheetTitle>
                      <div className="grid gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                        <Link
                          href="/pos"
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-fixed text-primary">
                            <Icon name="shopping_cart" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">POS Retail</span>
                            <span className="block text-xs text-muted-foreground">Hàng đóng gói, bán tại quầy</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </Link>
                        <a
                          href={posFnbUrl()}
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-warning/10 text-status-warning">
                            <Icon name="coffee" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">POS FnB</span>
                            <span className="block text-xs text-muted-foreground">Quầy thu ngân quán cà phê</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                        <a
                          href={posFnbUrl("/kds")}
                          onClick={() => setPosOpen(false)}
                          className="flex items-center gap-3 rounded-lg border border-border bg-surface-container-lowest p-4 hover:bg-surface-container-low"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-success/10 text-status-success">
                            <Icon name="restaurant" size={20} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold">Màn bếp KDS</span>
                            <span className="block text-xs text-muted-foreground">Theo dõi món đang chờ làm</span>
                          </span>
                          <Icon name="chevron_right" size={18} className="text-muted-foreground" />
                        </a>
                      </div>
                    </SheetContent>
                  </Sheet>
                </div>
              );
            }

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex flex-col press-scale-sm items-center justify-center flex-1 gap-0.5",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon name={tab.icon} size={20} fill={active} weight={active ? 500 : 400} />
                <span className="text-[11px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More */}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger className="flex flex-col press-scale-sm items-center justify-center flex-1 gap-0.5 text-muted-foreground hover:text-foreground">
              <Icon name="more_horiz" size={20} />
              <span className="text-[11px] font-medium">Thêm</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[70vh] p-0 rounded-t-lg">
              <SheetTitle className="px-5 py-4 border-b font-semibold">Menu</SheetTitle>
              <div className="overflow-y-auto h-[calc(70vh-60px)] p-4 space-y-5">
                {MORE_ITEMS.map((section) => (
                  <div key={section.section}>
                    <div className="px-1 pb-2 text-[11px] font-semibold text-muted-foreground uppercase">
                      {section.section}
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {section.items.map((item) => {
                        const active = pathname.startsWith(item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className={cn(
                              "flex flex-col press-scale-sm items-center gap-2 p-3 rounded-lg border",
                              active
                                ? "bg-primary-fixed border-primary/30 text-primary"
                                : "bg-surface-container-lowest hover:bg-surface-container-low border-border/50"
                            )}
                          >
                            <Icon name={item.icon} size={20} fill={active} />
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
        className="md:hidden h-16"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-hidden
      />
    </>
  );
}
