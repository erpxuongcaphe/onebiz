"use client";

import {
  ModuleSidebarLayout,
  type ModuleNavGroup,
} from "@/components/shared/module-sidebar-layout";

const analyticsNav: ModuleNavGroup[] = [
  {
    label: "Tổng hợp",
    items: [
      { label: "Tổng quan", href: "/phan-tich", icon: "bar_chart", exact: true },
      { label: "Cuối ngày", href: "/phan-tich/cuoi-ngay", icon: "event_available" },
      { label: "Tài chính", href: "/phan-tich/tai-chinh", icon: "account_balance_wallet" },
      { label: "Báo cáo P&L", href: "/phan-tich/bao-cao-tai-chinh", icon: "description" },
      { label: "Luồng tiền", href: "/phan-tich/luong-tien", icon: "swap_horiz" },
      { label: "Cảnh báo", href: "/phan-tich/canh-bao", icon: "warning" },
    ],
  },
  {
    label: "Bán hàng",
    items: [
      { label: "Bán hàng", href: "/phan-tich/ban-hang", icon: "trending_up" },
      { label: "F&B", href: "/phan-tich/fnb", icon: "local_cafe" },
      { label: "Đặt hàng", href: "/phan-tich/dat-hang", icon: "assignment" },
      { label: "Kênh bán", href: "/phan-tich/kenh-ban", icon: "public" },
    ],
  },
  {
    label: "Đối tượng",
    items: [
      { label: "Hàng hóa", href: "/phan-tich/hang-hoa", icon: "inventory_2" },
      { label: "Khách hàng", href: "/phan-tich/khach-hang", icon: "group" },
      { label: "Nhà cung cấp", href: "/phan-tich/nha-cung-cap", icon: "local_shipping" },
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
