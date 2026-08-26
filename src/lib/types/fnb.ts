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

/**
 * CEO 01/06/2026 — Sprint 2.3a: Snapshot lựa chọn modifier cho 1 dòng order.
 *
 * Lý do snapshot (NOT reference): modifier_groups + options có thể bị admin
 * đổi tên / sửa scale sau ngày bán → báo cáo cũ vẫn show đúng label gốc.
 * Pattern này giống cách lưu unitPrice trong invoice_items (snapshot price).
 *
 * RPC đọc option ID từ snapshot này để lấy định lượng BOM theo từng lựa chọn;
 * `scaleFactor` chỉ là fallback cho công thức cũ. `linkedProductId` vẫn phục
 * vụ đường topping cũ trong thời gian chuyển đổi.
 */
export interface ModifierSelectionOption {
  optionId: string;
  label: string;
  /** Hệ số tương thích của công thức cũ; BOM đã chuyển đổi không dùng số này. */
  scaleFactor: number | null;
  /** Phí cộng thêm (đã include vào unitPrice). Lưu lại để báo cáo. */
  priceDelta: number;
  /** Link tới NVL/SKU topping — RPC sẽ trừ tồn product này. */
  linkedProductId: string | null;
}

export interface ModifierSelectionPayload {
  groupId: string;
  groupName: string;
  /** Khi nào cần re-apply: nếu group thay rule, cashier có thể bị reset chọn. */
  rule: "single_required" | "single" | "multi";
  /** Group này scale BOM ingredient nào? Null nếu chỉ topping/size. */
  scaleTargetGroupId?: string | null;
  options: ModifierSelectionOption[];
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
  /**
   * CEO 01/06/2026 — Sprint 2.4b: snapshot modifier choices (Mức đường,
   * Mức đá, Topping động) đã chọn lúc cashier tạo item. KDS đọc để in
   * lên phiếu bếp + render trên màn KDS. RPC checkout đọc để scale BOM.
   */
  modifierSelections?: ModifierSelectionPayload[];
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
  /** Nhân viên được phân công giao đơn tự giao, nếu có. */
  deliveryStaffId?: string | null;
  /** Cấp khoảng cách đã được máy chủ chốt để tính phí giao hàng. */
  deliveryDistanceTier?: "near" | "mid" | "far" | "custom" | null;
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
  /**
   * CEO 01/06/2026 — Sprint 2.3a: Lựa chọn dynamic modifier (Mức đường,
   * Mức đá, Topping...) đã snapshot. Optional vì:
   *  - SP không gán modifier → cart line không có field này.
   *  - Cashier dùng hardcoded fallback → cũng không có (backward compat).
   * RPC checkout đọc option để lấy định lượng riêng của BOM nếu đã khai;
   * scaleFactor chỉ là fallback của công thức cũ, topping legacy vẫn dùng
   * linkedProductId trong thời gian chuyển đổi.
   */
  modifierSelections?: ModifierSelectionPayload[];
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
  /**
   * Đơn mở lại từ KDS không lưu snapshot khách hàng. Khi không có ngữ cảnh
   * cục bộ đáng tin, buộc thu ngân xác nhận Khách lẻ hoặc chọn lại khách trước
   * thanh toán thay vì âm thầm gán sai công nợ/điểm tích lũy.
   */
  customerConfirmationRequired?: boolean;
  orderDiscount?: FnbDiscountInput;
  /**
   * Giảm giá đã được lưu trong kitchen_orders (ví dụ sau tách bill). Đây
   * không phải giảm tay của tab, nên chỉ dùng để hiển thị đúng tổng và không
   * được gửi lại như một yêu cầu OTP mới khi thanh toán.
   */
  persistedOrderDiscountAmount?: number;
  /**
   * Day 3 16/05/2026: Khi cashier xin OTP duyệt giảm giá manual → lưu otpId
   * + reason vào tab để checkout V3 xác minh OTP và ghi audit log trong cùng
   * transaction thanh toán (truy vết được ai duyệt, không có audit "best effort").
   */
  discountAuditCtx?: { otpId: string; reason: string };
  /**
   * Những dòng đã được máy chủ nhận vào đơn bếp. Tách khỏi `lines` (món
   * chưa gửi) để thu ngân có thể thu tiền sau khi gửi bếp mà không thể vô
   * tình gửi lại hoặc sửa trực tiếp món bếp đang làm.
   *
   * Đây chỉ là snapshot hiển thị/nhập tiền. Máy chủ vẫn là nguồn chốt khi
   * thanh toán và tab sẽ nạp lại snapshot từ đơn bếp khi mở ở máy khác.
   */
  sentLines?: FnbOrderLine[];
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
  /**
   * Day 21/05/2026 (CEO): Nhân viên quán đi giao (KHÁC cashier tạo đơn).
   * Optional — có thể gán sau qua dialog "Gán shipper" trên list đơn.
   * Chỉ áp dụng khi orderType = "delivery" + platform = "direct" (tự giao).
   */
  deliveryStaffId?: string;
  /**
   * Day 21/05/2026 (CEO): Cấp ngưỡng km áp dụng phí giao.
   * - "near" / "mid" / "far": lấy fee từ bảng fnb_delivery_fee_tiers
   * - "custom": cashier nhập tay (legacy, vẫn cho phép)
   */
  deliveryDistanceTier?: "near" | "mid" | "far" | "custom";
}
