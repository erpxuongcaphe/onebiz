// Các kiểu dữ liệu liên quan đến nhà cung cấp

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  currentDebt: number;
  totalPurchases: number;
  isInternal?: boolean;
  branchId?: string;
  createdAt: string;
}

// Chi tiết nhà cung cấp mở rộng từ danh sách
export interface SupplierDetail extends Supplier {
  taxCode?: string;
  totalPaid: number;
}

// Lịch sử nhập hàng từ nhà cung cấp
export interface PurchaseHistoryItem {
  id: string;
  code: string;
  date: string;
  totalAmount: number;
  status: string;
  statusName: string;
  itemCount: number;
  createdBy: string;
}

// Lịch sử thanh toán cho nhà cung cấp
export interface PaymentHistoryItem {
  id: string;
  code: string;
  date: string;
  amount: number;
  method: string;
  note?: string;
  createdBy: string;
}

// Lịch sử trả hàng nhà cung cấp
export interface ReturnHistoryItem {
  id: string;
  code: string;
  date: string;
  originalCode: string;
  totalAmount: number;
  status: string;
  statusName: string;
  itemCount: number;
  createdBy: string;
}

// Đơn đặt hàng nhập
export interface PurchaseOrderEntry {
  id: string;
  code: string;
  date: string;
  supplierName: string;
  totalAmount: number;
  status: "pending" | "partial" | "completed" | "cancelled";
  statusName: string;
  expectedDate: string;
  createdBy: string;
  createdByName?: string;
}

// Trả hàng nhập
export interface PurchaseReturn {
  id: string;
  code: string;
  date: string;
  importCode: string;
  supplierName: string;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
  createdByName?: string;
  branchId?: string;
  branchName?: string;
}

// Hoá đơn đầu vào
export interface InputInvoice {
  id: string;
  code: string;
  date: string;
  supplierName: string;
  totalAmount: number;
  taxAmount: number;
  status: "recorded" | "unrecorded";
  statusName: string;
  createdBy: string;
  createdByName?: string;
  branchId?: string;
  branchName?: string;
}
