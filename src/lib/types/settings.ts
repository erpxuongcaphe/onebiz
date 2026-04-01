// Quyền hạn
export interface Permission {
  label: string;
  allowed: boolean;
}

// Vai trò người dùng
export interface Role {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  color: string;
  permissions: { group: string; items: Permission[] }[];
}

// Loại thông báo
export type NotificationType = "order_new" | "order_completed" | "stock_low" | "customer_new" | "payment_received";

// Thông báo hệ thống
export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  description: string;
  timeAgo: string;
  read: boolean;
}

// Cài đặt cửa hàng
export interface TenantSettings {
  storeName: string;
  phone: string;
  email: string;
  address: string;
  taxCode?: string;
  businessType: string;
  logoUrl?: string;
}
