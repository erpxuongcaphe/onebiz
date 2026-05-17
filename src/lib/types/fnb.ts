/**
 * F&B POS Types — Restaurant tables, Kitchen orders, Topping attachments
 */

// ── Table statuses ──

export type TableStatus = "available" | "occupied" | "reserved" | "cleaning";

export interface RestaurantTable {
  id: string;
  tenantId: string;
  branchId: string;
  tableNumber: number;
  name: string;
  zone: string | null;
  capacity: number;
  status: TableStatus;
  currentOrderId: string | null;
  positionX: number;
  positionY: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
}

// ── Kitchen order statuses ──

export type KitchenOrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "served"
  | "completed"
  | "cancelled";

export type KitchenItemStatus = "pending" | "preparing" | "ready";

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type DeliveryPlatform = "shopee_food" | "grab_food" | "gojek" | "be" | "direct";

// ── Topping attachment (JSONB on kitchen_order_items) ──

export interface ToppingAttachment {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

// ── Kitchen order item ──

export interface KitchenOrderItem {
  id: string;
  kitchenOrderId: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  note: string | null;
  toppings: ToppingAttachment[];
  status: KitchenItemStatus;
  startedAt: string | null;
  completedAt: string | null;
  /**
   * Sprint KITCHEN-1 (CEO 07/05): trạm chế biến cho item này (auto-fill từ
   * category.kitchen_station_id khi insert). Null = single-queue legacy mode.
   * Dùng để split phiếu in + filter KDS theo trạm.
   */
  kitchenStationId?: string | null;
}

// ── Kitchen order ──

export interface KitchenOrder {
  id: string;
  tenantId: string;
  branchId: string;
  invoiceId: string | null;
  tableId: string | null;
  orderNumber: string;
  orderType: OrderType;
  status: KitchenOrderStatus;
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  discountAmount: number;
  discountReason: string | null;
  deliveryPlatform: DeliveryPlatform | null;
  deliveryFee: number;
  /**
   * @deprecated Migration 00070: dùng `platformCommissionPercent` + `platformCommissionAmount`.
   * Vẫn giữ field cũ cho data legacy (đơn cũ trước migration).
   */
  platformCommission: number;
  /** % phí sàn lưu trên đơn (Shopee 25%, Grab 25%, Gojek 23%, Be 20%). */
  platformCommissionPercent: number;
  /** Số tiền phí sàn thực tế = round(total_gross * percent / 100). */
  platformCommissionAmount: number;
  mergedIntoId: string | null;
  originalTableId: string | null;
  parentOrderId: string | null;
  /** Populated in detail queries */
  items?: KitchenOrderItem[];
  /** Table name (joined) */
  tableName?: string;
  /** Profile name of creator (joined) */
  createdByName?: string;
}

// ── F&B Cart types (frontend state) ──

export interface FnbCartTopping {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export interface FnbOrderLine {
  id: string; // unique key for React
  productId: string;
  productName: string;
  variantId?: string;
  variantLabel?: string;
  quantity: number;
  unitPrice: number;
  toppings: FnbCartTopping[];
  note?: string;
  /** Computed: unitPrice * quantity + sum(toppings) */
  lineTotal: number;
}

export interface FnbDiscountInput {
  mode: "amount" | "percent";
  value: number;
}

export interface FnbTabSnapshot {
  id: string;
  label: string; // "Bàn 5" or "Mang về #1"
  tableId?: string;
  orderType: OrderType;
  kitchenOrderId?: string; // set after sendToKitchen
  customerId?: string;
  customerName: string;
  orderDiscount?: FnbDiscountInput;
  /**
   * Day 3 16/05/2026: Khi cashier xin OTP duyệt giảm giá manual → lưu otpId
   * + reason vào tab để khi checkout, service `recordDiscountAudit` ghi audit
   * log với link tới manager_otps row chính xác (truy vết được ai duyệt).
   */
  discountAuditCtx?: { otpId: string; reason: string };
  lines: FnbOrderLine[];
  /**
   * Sprint POS-FNB-EXT-1 (CEO 08/05): Ghi chú đơn — ghi chú toàn bill
   * (khác line.note là ghi chú từng món). Vd "Khách kiêng đường",
   * "Đơn ưu tiên VIP", "Không nhận túi nilon".
   * Pass vào sendToKitchen + in ra phiếu bếp dòng "📝 Ghi chú: ...".
   */
  orderNote?: string;
  /**
   * Sàn giao hàng (chỉ áp dụng khi orderType === "delivery").
   * Default "direct" = quán tự giao.
   */
  deliveryPlatform?: DeliveryPlatform;
  /** Phí giao hàng (VND), thường 15-30k. Khách trả thêm hoặc shop subsidize. */
  deliveryFee?: number;
  /**
   * % chiết khấu cho platform. Auto-fill từ settings khi pick platform,
   * user override được tại cart. Vd Shopee Food default 25%.
   */
  platformCommissionPercent?: number;
}
