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
  role: "owner" | "admin" | "manager" | "staff" | "cashier";
  isActive: boolean;
  createdAt: string;
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
//   store     — quán FnB (POS FnB + KDS)
//   warehouse — kho tổng (POS Retail + quản lý xuất nhập)
//   factory   — xưởng sản xuất (SX orders + NVL + thành phẩm về kho)
//   office    — văn phòng/HQ (không bán trực tiếp)
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
