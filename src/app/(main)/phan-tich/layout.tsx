"use client";

import {
  ModuleSidebarLayout,
  type ModuleNavGroup,
} from "@/components/shared/module-sidebar-layout";

// ============================================================
// Menu Phân tích — tái cấu trúc 21/05/2026 (CEO)
// ============================================================
// CEO 21/05: "càng nhiều báo cáo các góc nhìn khác nhau càng tốt nhưng
// hãy thiết kế menu lựa chọn báo cáo nó tinh tế, gọn gàng có thể chọn
// khi cần".
//
// Trước: 3 nhóm flat, 20 trang hiển thị, 13 trang ẩn (route có sẵn nhưng
// không có lối vào). Sau: 6 nhóm collapsible + ô search, exposing toàn bộ
// 32 báo cáo. Mỗi nhóm có thể đóng/mở, trạng thái persist localStorage.
//
// Quy tắc nhóm:
//   1. Tổng quan       — daily overview, executive snapshot, multi-channel
//   2. Doanh thu & Đơn — sales-focused (POS + online + KM + đổi/trả)
//   3. Khách hàng      — customer behavior, RFM, cohort
//   4. Hàng hóa & Tồn  — inventory, kiểm kê, lot, ABC, NVL, COGS
//   5. Tài chính       — P&L, cash flow, VAT, công nợ, phí sàn
//   6. NCC & Vận hành  — supplier, nhân viên, serve time
//
// Trang gốc /phan-tich (Tổng quan) luôn expand mặc định. Các nhóm chuyên
// sâu collapse mặc định để CEO không bị choáng — bấm vào mới mở.

const analyticsNav: ModuleNavGroup[] = [
  {
    label: "Tổng quan",
    collapsible: false, // Luôn mở — nhóm "trang chủ" báo cáo
    items: [
      { label: "Tổng quan", href: "/phan-tich", icon: "bar_chart", exact: true },
      { label: "Cuối ngày", href: "/phan-tich/cuoi-ngay", icon: "event_available" },
      { label: "Tổng hợp kênh", href: "/phan-tich/tong-hop-kenh", icon: "donut_large", badge: "Mới" },
      { label: "Cảnh báo", href: "/phan-tich/canh-bao", icon: "warning" },
    ],
  },
  {
    label: "Doanh thu & Đơn hàng",
    collapsible: true,
    defaultOpen: true,
    items: [
      { label: "Bán hàng", href: "/phan-tich/ban-hang", icon: "trending_up" },
      { label: "F&B", href: "/phan-tich/fnb", icon: "local_cafe" },
      { label: "Shipper FnB", href: "/phan-tich/fnb-shipper", icon: "delivery_dining", badge: "Mới" },
      { label: "Tuỳ chọn FnB", href: "/phan-tich/fnb-modifier", icon: "tune", badge: "Mới" },
      { label: "Đặt hàng", href: "/phan-tich/dat-hang", icon: "assignment" },
      { label: "Kênh bán", href: "/phan-tich/kenh-ban", icon: "public" },
      { label: "Khuyến mãi", href: "/phan-tich/khuyen-mai", icon: "redeem" },
      { label: "Trả hàng", href: "/phan-tich/tra-hang", icon: "assignment_return" },
    ],
  },
  {
    label: "Khách hàng",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Khách hàng", href: "/phan-tich/khach-hang", icon: "group" },
      { label: "Khách × Sản phẩm", href: "/phan-tich/khach-san-pham", icon: "diversity_3" },
      { label: "Khách quay lại", href: "/phan-tich/customer-cohort", icon: "repeat" },
      { label: "Phân khúc RFM", href: "/phan-tich/rfm", icon: "stars" },
    ],
  },
  {
    label: "Hàng hóa & Tồn kho",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Xuất - Nhập - Tồn", href: "/phan-tich/xuat-nhap-ton", icon: "inventory_2" },
      { label: "Phân tích hàng hóa", href: "/phan-tich/hang-hoa", icon: "analytics" },
      { label: "Phân loại ABC", href: "/phan-tich/abc-analysis", icon: "leaderboard" },
      { label: "Truy xuất lô", href: "/phan-tich/lot-traceability", icon: "qr_code" },
      { label: "Báo cáo kiểm kê", href: "/phan-tich/kiem-ke", icon: "fact_check" },
      { label: "Chênh lệch kiểm kê", href: "/phan-tich/chenh-lech-kiem-ke", icon: "compare_arrows" },
      { label: "Aging tồn kho", href: "/phan-tich/aging", icon: "schedule" },
      { label: "Tổn thất", href: "/phan-tich/ton-that", icon: "broken_image" },
      { label: "Tiêu hao NVL", href: "/phan-tich/tieu-hao-nvl", icon: "factory" },
      { label: "COGS theo BOM", href: "/phan-tich/cogs-theo-bom", icon: "receipt_long" },
    ],
  },
  {
    label: "Tài chính",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Tài chính", href: "/phan-tich/tai-chinh", icon: "account_balance_wallet" },
      { label: "Báo cáo P&L", href: "/phan-tich/bao-cao-tai-chinh", icon: "description" },
      { label: "Luồng tiền", href: "/phan-tich/luong-tien", icon: "swap_horiz" },
      { label: "VAT", href: "/phan-tich/vat", icon: "request_quote" },
      { label: "Công nợ aging", href: "/phan-tich/cong-no-aging", icon: "credit_card" },
      { label: "Phí sàn", href: "/phan-tich/platform-commission", icon: "percent" },
    ],
  },
  {
    label: "NCC & Vận hành",
    collapsible: true,
    defaultOpen: false,
    items: [
      { label: "Nhà cung cấp", href: "/phan-tich/nha-cung-cap", icon: "local_shipping" },
      { label: "Nhân viên", href: "/phan-tich/nhan-vien", icon: "badge" },
      { label: "Thời gian phục vụ", href: "/phan-tich/serve-time", icon: "timer" },
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
      // CEO 22/05/2026 (UX P1 #3): đồng nhất tên module = "Báo cáo".
      // Trước đây sidebar phụ nói "Phân tích" còn top-nav + drawer nói
      // "Báo cáo" → user confuse module này tên gì.
      title="Báo cáo"
      nav={analyticsNav}
      contentClassName="max-w-none"
      enableSearch
      persistKey="phan-tich"
    >
      {children}
    </ModuleSidebarLayout>
  );
}
