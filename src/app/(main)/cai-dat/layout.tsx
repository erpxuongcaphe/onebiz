"use client";

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
import {
  ModuleSidebarLayout,
  type ModuleNavGroup,
} from "@/components/shared/module-sidebar-layout";

const settingsNav: ModuleNavGroup[] = [
  {
    label: "Chung",
    items: [
      { label: "Cửa hàng", href: "/cai-dat", icon: Store, exact: true },
      { label: "Chi nhánh", href: "/cai-dat/chi-nhanh", icon: GitBranch },
      { label: "Phân quyền", href: "/cai-dat/phan-quyen", icon: Shield },
      { label: "Ngôn ngữ", href: "/cai-dat/ngon-ngu", icon: Globe },
      { label: "Giao diện", href: "/cai-dat/giao-dien", icon: Palette },
    ],
  },
  {
    label: "Bán hàng",
    items: [
      { label: "Bán hàng", href: "/cai-dat/ban-hang", icon: ShoppingCart },
      { label: "Hóa đơn", href: "/cai-dat/hoa-don", icon: FileText },
      { label: "In ấn", href: "/cai-dat/in-an", icon: Printer },
      { label: "Bảng giá", href: "/cai-dat/bang-gia", icon: DollarSign },
      { label: "Khuyến mãi", href: "/cai-dat/khuyen-mai", icon: Tag },
      { label: "Tích điểm", href: "/cai-dat/tich-diem", icon: Star },
    ],
  },
  {
    label: "Tích hợp",
    items: [
      { label: "Thanh toán", href: "/cai-dat/thanh-toan", icon: CreditCard },
      { label: "Giao hàng", href: "/cai-dat/giao-hang", icon: Truck },
      { label: "Thông báo", href: "/cai-dat/thong-bao", icon: Bell },
      { label: "Kết nối", href: "/cai-dat/ket-noi", icon: Link2 },
    ],
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ModuleSidebarLayout title="Cài đặt" nav={settingsNav} contentClassName="max-w-4xl">
      {children}
    </ModuleSidebarLayout>
  );
}
