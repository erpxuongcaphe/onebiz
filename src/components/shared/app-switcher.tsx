"use client";

// ---------------------------------------------------------------------------
// AppSwitcher — Google-style 3x3 app grid trong top nav
// - Click icon grid → popover 9 tile module chính
// - Stitch design: primary-fixed tile + primary icon (clean, unified brand)
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
        className="hidden md:inline-flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:text-primary hover:bg-surface-container-low transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/30 press-scale-sm"
        title="Ứng dụng"
      >
        <Icon name="apps" size={22} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="!w-[300px] p-4 rounded-2xl"
      >
        <div className="grid grid-cols-3 gap-1">
          {APPS.map((app) => (
            <Link
              key={app.label}
              href={app.href}
              className="flex flex-col items-center gap-2 py-3 px-2 rounded-xl hover:bg-surface-container-low transition-colors group press-scale-sm"
            >
              <span className="h-11 w-11 rounded-2xl bg-primary-fixed flex items-center justify-center group-hover:bg-primary-fixed-dim group-hover:scale-[1.04] transition-all">
                <Icon
                  name={app.iconName}
                  size={22}
                  className="text-primary"
                  fill={false}
                />
              </span>
              <span className="text-[11px] font-medium text-center leading-tight text-foreground">
                {app.label}
              </span>
            </Link>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
