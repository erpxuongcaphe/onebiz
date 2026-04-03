// Mã giảm giá
export interface Coupon {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "fixed" | "percent";
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerCustomer: number | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  appliesTo: "all" | "category" | "product";
  appliesToIds: string[];
  createdAt: string;
  updatedAt: string;
}

// Lịch sử sử dụng coupon
export interface CouponUsage {
  id: string;
  couponId: string;
  invoiceId: string | null;
  customerId: string | null;
  discountAmount: number;
  usedAt: string;
}

// Kết quả validate coupon (từ RPC)
export interface CouponValidation {
  valid: boolean;
  error?: string;
  coupon_id?: string;
  code?: string;
  name?: string;
  type?: "fixed" | "percent";
  value?: number;
  discount_amount?: number;
}
