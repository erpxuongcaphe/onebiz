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

// Chi nhánh
export interface Branch {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  phone?: string;
  isDefault: boolean;
  createdAt: string;
}
