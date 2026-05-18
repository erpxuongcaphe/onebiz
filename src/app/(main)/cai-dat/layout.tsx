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
      { label: "Kho & công thức", href: "/cai-dat/kho-hang", icon: "inventory_2" },
      { label: "Hóa đơn", href: "/cai-dat/hoa-don", icon: "description", badge: "Sắp ra mắt" },
      { label: "In ấn", href: "/cai-dat/in-an", icon: "print" },
      { label: "Thiết bị POS", href: "/cai-dat/thiet-bi-pos", icon: "lock" },
      { label: "Bảng giá", href: "/cai-dat/bang-gia", icon: "attach_money" },
      { label: "Giá theo nguồn đơn (FnB)", href: "/cai-dat/bang-gia/platforms", icon: "delivery_dining" },
      { label: "Khuyến mãi", href: "/cai-dat/khuyen-mai", icon: "sell" },
      { label: "Mã giảm giá", href: "/cai-dat/ma-giam-gia", icon: "confirmation_number" },
      { label: "Tích điểm", href: "/cai-dat/tich-diem", icon: "star" },
      { label: "POS FnB nâng cao", href: "/cai-dat/fnb-presets", icon: "local_cafe" },
    ],
  },
  {
    label: "Tích hợp",
    items: [
      { label: "Thanh toán", href: "/cai-dat/thanh-toan", icon: "credit_card" },
      { label: "Giao hàng", href: "/cai-dat/giao-hang", icon: "local_shipping", badge: "Sắp ra mắt" },
      { label: "Thông báo", href: "/cai-dat/thong-bao", icon: "notifications" },
      { label: "Kết nối", href: "/cai-dat/ket-noi", icon: "link", badge: "Sắp ra mắt" },
    ],
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // CEO 13/05: nâng max-w lên 6xl (1152px) để bảng Chi nhánh / Phân quyền
  // hiển thị đủ cột, không bó hẹp ở giữa khi viewport rộng. Form ngắn
  // (ngôn ngữ, giao diện...) tự wrap max-w-2xl bên trong nếu cần.
  return (
    <ModuleSidebarLayout title="Cài đặt" nav={settingsNav} contentClassName="max-w-6xl">
      {children}
    </ModuleSidebarLayout>
  );
}
