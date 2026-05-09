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
  { label: "Kho", href: "/hang-hoa/ton-kho", iconName: "warehouse" },
  { label: "Bán hàng", href: "/don-hang/hoa-don", iconName: "receipt_long" },
  { label: "Mua hàng", href: "/hang-hoa/dat-hang-nhap", iconName: "add_box" },
  { label: "Sản phẩm", href: "/hang-hoa", iconName: "inventory_2" },
  { label: "Báo cáo", href: "/phan-tich", iconName: "analytics" },
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
        <Icon name="apps" size={20} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={10}
        className="!w-[320px] p-4 rounded-lg"
      >
        <div className="grid grid-cols-3 gap-1">
          {APPS.map((app) => (
            <Link
              key={app.label}
              href={app.href}
              className="flex flex-col items-center gap-2 rounded-lg px-2 py-3 transition-colors group press-scale-sm hover:bg-surface-container-low"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-fixed transition-all group-hover:scale-[1.04] group-hover:bg-primary-fixed-dim">
                <Icon
                  name={app.iconName}
                  size={20}
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
