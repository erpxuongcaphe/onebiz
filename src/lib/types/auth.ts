/**
 * Legacy role values của hệ thống (profiles.role text column với CHECK
 * constraint từ 00001_initial_schema). Vẫn còn vì:
 *   - Owner bypass mọi permission check (usePermissions hook line 28)
 *   - Backward compat cho code cũ kiểm `user.role === "owner"` v.v.
 *
 * RBAC thật chạy qua `profiles.role_id` → `roles.id` → `role_permissions`
 * (dynamic, custom role tenant tự tạo). Đừng thêm role mới vào enum này
 * — tạo role custom qua `/cai-dat/phan-quyen` thay vì hard-code.
 */
export type LegacyRole = "owner" | "admin" | "manager" | "staff" | "cashier";

// Thông tin người dùng
export interface UserProfile {
  id: string;
  tenantId: string;
  branchId?: string;
  roleId?: string;
  fullName: string;
  email: string;
  phone?: string;
  avatarUrl?: string;
  /**
   * Legacy role (string, không enum). Cho phép admin tạo role custom qua
   * RBAC (vd "Trưởng ca bar") mà TypeScript không complain. Code consumer
   * vẫn so sánh được `user.role === "owner"` bình thường (TS chấp nhận
   * literal === string).
   *
   * Owner check: dùng `isOwnerRole(user.role)` helper để rõ intent.
   */
  role: string;
  isActive: boolean;
  createdAt: string;
}

/** Owner role bypass mọi permission check. Helper để giữ ý nghĩa rõ ràng. */
export function isOwnerRole(role: string | null | undefined): boolean {
  return role === "owner";
}

/** True nếu role nằm trong 5 legacy roles built-in (owner/admin/manager/staff/cashier). */
export function isLegacyRole(role: string | null | undefined): role is LegacyRole {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "manager" ||
    role === "staff" ||
    role === "cashier"
  );
}

// Thông tin doanh nghiệp
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  createdAt: string;
}

// Loại chi nhánh — quyết định POS/kho/báo cáo hiển thị ra sao.
// CEO 13/05/2026: phân định rõ FnB và Retail là 2 mảng riêng.
//   store     — Cửa hàng FnB (POS FnB + KDS) — quán bán đồ uống tại bàn / mang về / giao hàng
//   warehouse — Kho tổng (POS Retail) — bán sỉ hạt rang + máy móc cho khách doanh nghiệp
//   factory   — Xưởng sản xuất (SX orders) — rang hạt, không POS bán hàng
//   office    — Văn phòng HQ — ghi nhận chi phí điều hành (lương BOD, văn phòng phẩm,
//               điện nước HQ...). Không POS bán hàng nhưng có sổ quỹ + công nợ.
export type BranchType = "store" | "warehouse" | "factory" | "office";

// Chi nhánh
export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  /**
   * Loại chi nhánh. Mặc định "store" nếu DB chưa set để backward compat
   * (chi nhánh cũ trước migration branch_type).
   */
  branchType: BranchType;
  /** Mã chi nhánh (vd "FNB01", "KHO01", "XUONG"). Hiển thị trên header POS. */
  code?: string;
  address?: string;
  phone?: string;
  isDefault: boolean;
  createdAt: string;
}
