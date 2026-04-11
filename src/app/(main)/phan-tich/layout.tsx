"use client";

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
  FileText,
  AlertTriangle,
  ArrowLeftRight,
} from "lucide-react";
import {
  ModuleSidebarLayout,
  type ModuleNavGroup,
} from "@/components/shared/module-sidebar-layout";

const analyticsNav: ModuleNavGroup[] = [
  {
    label: "Tổng hợp",
    items: [
      { label: "Tổng quan", href: "/phan-tich", icon: BarChart3, exact: true },
      { label: "Cuối ngày", href: "/phan-tich/cuoi-ngay", icon: CalendarCheck },
      { label: "Tài chính", href: "/phan-tich/tai-chinh", icon: Wallet },
      { label: "Báo cáo P&L", href: "/phan-tich/bao-cao-tai-chinh", icon: FileText },
      { label: "Luồng tiền", href: "/phan-tich/luong-tien", icon: ArrowLeftRight },
      { label: "Cảnh báo", href: "/phan-tich/canh-bao", icon: AlertTriangle },
    ],
  },
  {
    label: "Bán hàng",
    items: [
      { label: "Bán hàng", href: "/phan-tich/ban-hang", icon: TrendingUp },
      { label: "Đặt hàng", href: "/phan-tich/dat-hang", icon: ClipboardList },
      { label: "Kênh bán", href: "/phan-tich/kenh-ban", icon: Globe },
    ],
  },
  {
    label: "Đối tượng",
    items: [
      { label: "Hàng hóa", href: "/phan-tich/hang-hoa", icon: Package },
      { label: "Khách hàng", href: "/phan-tich/khach-hang", icon: Users },
      { label: "Nhà cung cấp", href: "/phan-tich/nha-cung-cap", icon: Truck },
    ],
  },
];

export default function PhanTichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleSidebarLayout
      title="Phân tích"
      nav={analyticsNav}
      contentClassName="max-w-none"
    >
      {children}
    </ModuleSidebarLayout>
  );
}
