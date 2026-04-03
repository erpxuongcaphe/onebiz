// Sản phẩm trong giỏ hàng
export interface CartItem {
  id: string;
  productId: string;
  name: string;
  quantity: number;
  price: number;
  discount: number;
}

// Tab đơn hàng tại quầy
export interface OrderTab {
  id: string;
  label: string;
  cart: CartItem[];
  customerId: string | null;
  customerName: string;
  /** Thông tin giao hàng (chỉ dùng trong mode delivery) */
  shipping?: ShippingInfo;
}

// Thông tin giao hàng
export interface ShippingInfo {
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  deliveryPartnerId: string;
  deliveryPartnerName: string;
  shippingFee: number;
  codAmount: number;
  isCod: boolean;
  note: string;
}

// Đối tác giao hàng (dùng trong POS)
export interface PosDeliveryPartner {
  id: string;
  name: string;
  logo?: string;
}

// Mã giảm giá / Coupon
export interface CouponInfo {
  code: string;
  type: "fixed" | "percent";
  value: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
}

// Chế độ bán hàng
export type SaleMode = "quick" | "normal" | "delivery";

// Phương thức thanh toán
export type PaymentMethod = "cash" | "transfer" | "card";
