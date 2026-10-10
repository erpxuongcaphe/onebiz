import type { ModuleNavGroup, ModuleNavItem } from "./module-sidebar-layout";

interface SettingsItem extends ModuleNavItem { permissions?: string[] }
interface SettingsGroup extends Omit<ModuleNavGroup, "items"> { items: SettingsItem[] }

export const settingsNav: SettingsGroup[] = [
  { label: "Doanh nghiệp & nhân sự", items: [
    { label: "Tổng quan cài đặt", href: "/cai-dat", icon: "settings", exact: true },
    { label: "Thông tin doanh nghiệp", href: "/he-thong/thiet-lap", icon: "business", permissions: ["system.manage_roles"] },
    { label: "Chi nhánh", href: "/cai-dat/chi-nhanh", icon: "apartment", permissions: ["system.manage_branches"] },
    { label: "Người dùng", href: "/he-thong/users", icon: "manage_accounts", permissions: ["system.manage_users"] },
    { label: "Vai trò & phân quyền", href: "/cai-dat/phan-quyen", icon: "shield", permissions: ["system.manage_roles"] },
    { label: "Ngôn ngữ", href: "/cai-dat/ngon-ngu", icon: "language" },
  ] },
  { label: "Bán hàng & thanh toán", items: [
    { label: "Quy tắc bán hàng", href: "/cai-dat/ban-hang", icon: "shopping_cart" },
    { label: "Thanh toán", href: "/cai-dat/thanh-toan", icon: "credit_card" },
    { label: "Bảng giá", href: "/cai-dat/bang-gia", icon: "attach_money" },
    { label: "Khuyến mãi", href: "/cai-dat/khuyen-mai", icon: "sell" },
    { label: "Mã giảm giá", href: "/cai-dat/ma-giam-gia", icon: "confirmation_number" },
    { label: "Tích điểm", href: "/cai-dat/tich-diem", icon: "star" },
  ] },
  { label: "Vận hành F&B", items: [
    { label: "Bàn & khu vực", href: "/he-thong/quan-ly-ban", icon: "chair", permissions: ["system.manage_branches"] },
    { label: "Sơ đồ bàn", href: "/he-thong/so-do-ban", icon: "map", permissions: ["floor_plan.view"] },
    { label: "POS F&B nâng cao", href: "/cai-dat/fnb-presets", icon: "local_cafe" },
    { label: "Giá theo nguồn đơn", href: "/cai-dat/bang-gia/platforms", icon: "delivery_dining" },
    { label: "Phí giao hàng", href: "/cai-dat/phi-giao-hang", icon: "local_shipping" },
  ] },
  { label: "Kho & thiết bị", items: [
    { label: "Kho & công thức", href: "/cai-dat/kho-hang", icon: "inventory_2" },
    { label: "Máy in & mẫu phiếu", href: "/cai-dat/in-an", icon: "print", permissions: ["system.manage_branches"] },
    { label: "Thiết bị POS", href: "/cai-dat/thiet-bi-pos", icon: "lock" },
  ] },
  { label: "Kiểm soát & lịch sử", items: [
    { label: "Ca chờ đối chiếu", href: "/he-thong/ca-cho-doi-soat", icon: "schedule", permissions: ["shifts.reconcile_any", "shifts.reconcile_own_branch"] },
    { label: "Lịch sử thao tác", href: "/he-thong/audit", icon: "pending_actions", permissions: ["system.view_audit"] },
    { label: "Toàn vẹn kho", href: "/he-thong/toan-ven-kho", icon: "fact_check", permissions: ["system.view_audit"] },
    { label: "Kiểm tra dữ liệu POS", href: "/he-thong/toan-ven-pos", icon: "point_of_sale", permissions: ["system.view_audit"] },
    { label: "Cấp OTP duyệt từ xa", href: "/cap-otp", icon: "vpn_key", permissions: ["system.issue_otp"] },
  ] },
  { label: "Thông báo & kết nối", items: [
    { label: "Thông báo", href: "/cai-dat/thong-bao", icon: "notifications" },
    { label: "Hóa đơn", href: "/cai-dat/hoa-don", icon: "description", badge: "Sắp ra mắt" },
    { label: "Giao hàng", href: "/cai-dat/giao-hang", icon: "local_shipping", badge: "Sắp ra mắt" },
    { label: "Kết nối", href: "/cai-dat/ket-noi", icon: "link", badge: "Sắp ra mắt" },
  ] },
];

export function visibleSettingsNav(hasPermission: (permission: string) => boolean): SettingsGroup[] {
  return settingsNav.map((group) => ({ ...group, items: group.items.filter((item) =>
    !item.permissions || item.permissions.some(hasPermission),
  ) })).filter((group) => group.items.length > 0);
}
