// Các kiểu dữ liệu dùng chung cho tất cả các nghiệp vụ

export interface QueryParams {
  page: number;
  pageSize: number;
  search?: string;
  /**
   * CEO 04/07/2026: giới hạn tìm kiếm vào 1 cột cụ thể (vd "code" | "name" |
   * "phone" | "customer_name"). Không set / "all" → giữ OR nhiều cột như cũ.
   * Mỗi service tự map giá trị hợp lệ; giá trị lạ → fallback OR (an toàn).
   */
  searchField?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  filters?: Record<string, string | string[]>;
  /** Lọc theo chi nhánh — undefined = tất cả chi nhánh (CEO view) */
  branchId?: string;
  /**
   * 00335 — cột ngày dùng để lọc/sắp xếp danh sách hoá đơn.
   * Bỏ trống = "ngay_chung_tu" (NGÀY CHỨNG TỪ, mặc định cho mọi màn nghiệp vụ).
   * Truyền "created_at" khi cần lọc theo THỜI ĐIỂM THAO TÁC THẬT — ví dụ đơn
   * trong ca: mốc so sánh là giờ mở ca, nếu lọc theo ngày chứng từ thì hoá đơn
   * ghi lùi ngày sẽ lọt/rơi khỏi ca sai.
   */
  dateColumn?: "ngay_chung_tu" | "created_at";
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
