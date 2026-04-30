"use client";

import {
  ModuleSidebarLayout,
  type ModuleNavGroup,
} from "@/components/shared/module-sidebar-layout";

const settingsNav: ModuleNavGroup[] = [
  {
    label: "Chung",
    items: [
      { label: "Cửa hàng", href: "/cai-dat", icon: "storefront", exact: true },
      { label: "Chi nhánh", href: "/cai-dat/chi-nhanh", icon: "fork_right" },
      { label: "Phân quyền", href: "/cai-dat/phan-quyen", icon: "shield" },
      { label: "Ngôn ngữ", href: "/cai-dat/ngon-ngu", icon: "public" },
      { label: "Giao diện", href: "/cai-dat/giao-dien", icon: "palette" },
    ],
  },
  {
    label: "Bán hàng",
    items: [
      { label: "Bán hàng", href: "/cai-dat/ban-hang", icon: "shopping_cart" },
      { label: "Hóa đơn", href: "/cai-dat/hoa-don", icon: "description" },
      { label: "In ấn", href: "/cai-dat/in-an", icon: "print" },
      { label: "Thiết bị POS", href: "/cai-dat/thiet-bi-pos", icon: "lock" },
      { label: "Bảng giá", href: "/cai-dat/bang-gia", icon: "attach_money" },
      { label: "Khuyến mãi", href: "/cai-dat/khuyen-mai", icon: "sell" },
      { label: "Mã giảm giá", href: "/cai-dat/ma-giam-gia", icon: "confirmation_number" },
      { label: "Tích điểm", href: "/cai-dat/tich-diem", icon: "star" },
    ],
  },
  {
    label: "Tích hợp",
    items: [
      { label: "Thanh toán", href: "/cai-dat/thanh-toan", icon: "credit_card" },
      { label: "Giao hàng", href: "/cai-dat/giao-hang", icon: "local_shipping" },
      { label: "Thông báo", href: "/cai-dat/thong-bao", icon: "notifications" },
      { label: "Kết nối", href: "/cai-dat/ket-noi", icon: "link" },
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
