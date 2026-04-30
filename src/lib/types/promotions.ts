// Chương trình khuyến mãi
//
// Sprint KM-1 (00042) bổ sung 7 field cho engine:
//   channel / branchIds / usageLimit / usageCount / timeStart / timeEnd / daysOfWeek
export type PromotionChannel = "retail" | "fnb" | "both";

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: "discount_percent" | "discount_fixed" | "buy_x_get_y" | "gift";
  value: number;
  minOrderAmount: number;
  buyQuantity: number | null;
  getQuantity: number | null;
  appliesTo: "all" | "category" | "product";
  appliesToIds: string[];
  startDate: string;
  endDate: string;
  isActive: boolean;
  autoApply: boolean;
  priority: number;
  /** retail / fnb / both — channel áp dụng */
  channel: PromotionChannel;
  /** Mảng branch_id giới hạn KM. Rỗng = áp toàn chuỗi. */
  branchIds: string[];
  /** Giới hạn tổng lượt dùng. null = unlimited. */
  usageLimit: number | null;
  /** Số lượt đã dùng (auto-increment ở engine). */
  usageCount: number;
  /** Giờ vàng start (HH:mm:ss). null + timeEnd null = áp cả ngày. */
  timeStart: string | null;
  /** Giờ vàng end (HH:mm:ss). */
  timeEnd: string | null;
  /** Mảng [0..6] (0=CN, 1=T2, ..., 6=T7). Rỗng = áp mọi ngày. */
  daysOfWeek: number[];
  /**
   * KM-3 (00043): danh sách product_id sẽ tặng khi promotion type='gift'
   * và đơn match điều kiện. Mỗi ID = 1 quà (qty 1). Rỗng = chưa cấu hình.
   * Chỉ dùng cho type='gift'; BOGO tự pick từ eligible items rẻ nhất.
   */
  giftProductIds: string[];
  createdAt: string;
  updatedAt: string;
}

// Cài đặt khuyến mãi cấp tenant (1 row / tenant)
export interface PromotionSettings {
  tenantId: string;
  /** Engine tự chọn KM giảm nhiều nhất khi cart match nhiều KM */
  autoApplyBest: boolean;
  /** Cho phép cộng dồn nhiều KM trong 1 đơn */
  allowMultiple: boolean;
  /** In thông tin KM trên hoá đơn */
  showOnInvoice: boolean;
  createdAt: string;
  updatedAt: string;
}
