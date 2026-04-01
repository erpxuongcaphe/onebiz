// Các kiểu dữ liệu dùng chung cho tất cả các nghiệp vụ

export interface QueryParams {
  page: number;
  pageSize: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, string | string[]>;
}

export interface QueryResult<T> {
  data: T[];
  total: number;
}

// Dùng chung cho trang chi tiết hoá đơn, đơn hàng, vận chuyển, trả hàng
export interface StatusChange {
  id: string;
  date: string;
  status: string;
  location?: string;
  note?: string;
  createdBy?: string;
}

// Dòng chi tiết cơ bản cho hoá đơn, đơn hàng, đơn nhập, trả hàng
export interface BaseLineItem {
  id: string;
  productCode: string;
  productName: string;
  quantity: number;
  unit: string;
}

export type DateRange = "today" | "week" | "month";
