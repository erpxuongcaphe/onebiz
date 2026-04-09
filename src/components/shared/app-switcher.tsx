"use client";

// ---------------------------------------------------------------------------
// AppSwitcher — Google-style 3x3 app grid trong top nav
// - Click icon grid → popover 9 tile module chính
// - Mỗi tile có icon, tên, gradient mềm theo nhóm
// ---------------------------------------------------------------------------

import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  LineChart,
  Wallet,
  Settings,
  PackagePlus,
  Globe,
  Grid3x3,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";

interface AppTile {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  gradient: string;
  external?: boolean;
}

const APPS: AppTile[] = [
  {
    label: "Tổng quan",
    href: "/",
    icon: LayoutDashboard,
    gradient: "from-blue-500 to-blue-600",
  },
  {
    label: "Hàng hóa",
    href: "/hang-hoa",
    icon: Package,
    gradient: "from-indigo-500 to-indigo-600",
  },
  {
    label: "Đơn hàng",
    href: "/don-hang/hoa-don",
    icon: ShoppingCart,
    gradient: "from-violet-500 to-violet-600",
  },
  {
    label: "Khách hàng",
    href: "/khach-hang",
    icon: Users,
    gradient: "from-cyan-500 to-cyan-600",
  },
  {
    label: "Phân tích",
    href: "/phan-tich",
    icon: LineChart,
    gradient: "from-emerald-500 to-emerald-600",
  },
  {
    label: "Sổ quỹ",
    href: "/so-quy",
    icon: Wallet,
    gradient: "from-amber-500 to-amber-600",
  },
  {
    label: "Bán online",
    href: "/ban-online",
    icon: Globe,
    gradient: "from-pink-500 to-pink-600",
  },
  {
    label: "POS",
    href: "/pos",
    icon: PackagePlus,
    gradient: "from-emerald-500 to-emerald-600",
  },
  {
    label: "Cài đặt",
    href: "/cai-dat",
    icon: Settings,
    gradient: "from-slate-500 to-slate-600",
  },
];

export function AppSwitcher() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="hidden md:inline-flex items-center justify-center h-8 w-8 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors cursor-pointer outline-none"
        title="Chuyển ứng dụng"
      >
        <Grid3x3 className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="p-3 w-[320px]"
      >
        <div className="px-1 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Ứng dụng OneBiz
        </div>
        <div className="grid grid-cols-3 gap-2">
          {APPS.map((app) => {
            const Icon = app.icon;
            const Comp = app.external ? "a" : Link;
            const extraProps = app.external
              ? { target: "_blank", rel: "noreferrer" }
              : {};
            return (
              <Comp
                key={app.label}
                href={app.href}
                {...extraProps}
                className="flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-muted transition-colors group"
              >
                <span
                  className={`h-11 w-11 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all`}
                >
                  <Icon className="h-5 w-5 text-white" />
                </span>
                <span className="text-[11px] font-medium text-center leading-tight">
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
