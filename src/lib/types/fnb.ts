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
  platformCommission: number;
  mergedIntoId: string | null;
  originalTableId: string | null;
  parentOrderId: string | null;
  /** Populated in detail queries */
  items?: KitchenOrderItem[];
  /** Table name (joined) */
  tableName?: string;
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
  lines: FnbOrderLine[];
}
