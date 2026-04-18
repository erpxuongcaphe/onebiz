"use client";

// ---------------------------------------------------------------------------
// AppSwitcher — Google-style 3x3 app grid trong top nav
// - Click icon grid → popover 9 tile module chính
// - Stitch design: dùng primary-fixed + primary (filled icon button MD3)
//   thay vì random rainbow gradient — match "clean, unified" brand.
// ---------------------------------------------------------------------------

import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

interface AppTile {
  label: string;
  href: string;
  iconName: string;
  external?: boolean;
}

const APPS: AppTile[] = [
  { label: "Tổng quan", href: "/", iconName: "dashboard" },
  { label: "Hàng hóa", href: "/hang-hoa", iconName: "inventory_2" },
  { label: "Đơn hàng", href: "/don-hang/hoa-don", iconName: "shopping_cart" },
  { label: "Khách hàng", href: "/khach-hang", iconName: "groups" },
  { label: "Phân tích", href: "/phan-tich", iconName: "analytics" },
  { label: "Sổ quỹ", href: "/so-quy", iconName: "account_balance_wallet" },
  { label: "Bán online", href: "/ban-online", iconName: "language" },
  { label: "POS", href: "/pos", iconName: "point_of_sale" },
  { label: "Cài đặt", href: "/cai-dat", iconName: "settings" },
];

export function AppSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden md:inline-flex items-center justify-center h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-container-low transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        title="Chuyển ứng dụng"
      >
        <Icon name="grid_view" size={20} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="p-3 w-[320px] rounded-xl ambient-shadow"
      >
        <div className="px-1 pb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
          Ứng dụng OneBiz
        </div>
        <div className="grid grid-cols-3 gap-2">
          {APPS.map((app) => {
            const Comp = app.external ? "a" : Link;
            const extraProps = app.external
              ? { target: "_blank", rel: "noreferrer" }
              : {};
            return (
              <Comp
                key={app.label}
                href={app.href}
                {...extraProps}
                className="flex flex-col items-center gap-2 p-2.5 rounded-lg hover:bg-surface-container-low transition-colors group press-scale-sm"
              >
                <span className="h-12 w-12 rounded-2xl bg-primary-fixed flex items-center justify-center group-hover:bg-primary-fixed-dim transition-colors">
                  <Icon name={app.iconName} size={22} className="text-primary" />
                </span>
                <span className="text-[11px] font-medium text-center leading-tight text-foreground">
                  {app.label}
                </span>
              </Comp>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
