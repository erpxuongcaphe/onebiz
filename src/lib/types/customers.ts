// Các kiểu dữ liệu liên quan đến khách hàng

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  currentDebt: number;
  totalSales: number;
  totalSalesMinusReturns: number;
  groupId?: string;
  groupName?: string;
  type: "individual" | "company";
  gender?: "male" | "female";
  isInternal?: boolean;
  branchId?: string;
  createdAt: string;
}

// Lịch sử mua hàng của khách hàng
export interface PurchaseHistory {
  id: string;
  invoiceCode: string;
  date: string;
  totalAmount: number;
  status: string;
  statusName: string;
  createdBy: string;
}
