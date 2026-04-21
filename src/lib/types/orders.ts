import type { BaseLineItem, StatusChange } from "./common";

// Mục trong danh sách hóa đơn
export interface Invoice {
  id: string;
  code: string;
  date: string;
  returnCode?: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  totalAmount: number;
  discount: number;
  taxAmount: number;
  paid: number;
  debt: number;
  status: "processing" | "completed" | "cancelled" | "delivery_failed";
  deliveryType: "no_delivery" | "delivery";
  /**
   * Trạng thái giao hàng khớp với `ShippingStatus` (shipping_orders.status).
   * Được derive từ shipping_order liên kết, null nếu chưa tạo vận đơn.
   */
  deliveryStatus?:
    | "pending"
    | "picked_up"
    | "in_transit"
    | "delivered"
    | "returned"
    | "cancelled";
  createdBy: string;
}

// Dòng sản phẩm trong hóa đơn chi tiết
export interface InvoiceLineItem extends BaseLineItem {
  unitPrice: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

// Chi tiết hóa đơn
export interface InvoiceDetail extends Invoice {
  statusName: string;
  customerPhone: string;
  items: InvoiceLineItem[];
  subtotal: number;
  paidAmount: number;
  remaining: number;
  paymentMethod: string;
  note?: string;
  createdAt: string;
  timeline: StatusChange[];
}

// Trạng thái đơn nhập hàng (khớp DB enum)
export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partial"
  | "completed"
  | "cancelled";

// Mục trong danh sách đơn nhập hàng
export interface PurchaseOrder {
  id: string;
  code: string;
  orderCode?: string;
  date: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  amountOwed: number;
  taxAmount: number;
  total: number;
  paid: number;
  status: PurchaseOrderStatus;
  createdBy: string;
  createdByName?: string;
  importedBy?: string;
}

// Dòng sản phẩm trong đơn nhập hàng
export interface POLineItem extends BaseLineItem {
  costPrice: number;
  vatRate: number;
  vatAmount: number;
  total: number;
}

// Lịch sử nhập kho
export interface ImportHistory {
  id: string;
  date: string;
  status: string;
  note?: string;
  createdBy: string;
}

// Chi tiết đơn nhập hàng
export interface PurchaseOrderDetail {
  id: string;
  code: string;
  orderCode?: string;
  date: string;
  status: "draft" | "imported" | "cancelled";
  statusName: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  supplierPhone: string;
  items: POLineItem[];
  totalAmount: number;
  paidAmount: number;
  remaining: number;
  note?: string;
  createdBy: string;
  importedBy?: string;
  createdAt: string;
  timeline: ImportHistory[];
}

// Mục trong danh sách đơn bán hàng
export interface SalesOrder {
  id: string;
  code: string;
  date: string;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  status: "new" | "confirmed" | "delivering" | "completed" | "cancelled";
  statusName: string;
  createdBy: string;
  createdByName?: string;
}

// Dòng sản phẩm trong đơn bán hàng
export interface OrderLineItem extends BaseLineItem {
  unitPrice: number;
  total: number;
}

// Chi tiết đơn bán hàng
export interface SalesOrderDetail {
  id: string;
  code: string;
  date: string;
  status: "pending" | "confirmed" | "processing" | "completed" | "cancelled";
  statusName: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryPhone: string;
  deliveryMethod: string;
  items: OrderLineItem[];
  totalAmount: number;
  discount: number;
  finalAmount: number;
  note?: string;
  createdBy: string;
  createdAt: string;
  timeline: StatusChange[];
}

// Mục trong danh sách đơn trả hàng
export interface ReturnOrder {
  id: string;
  code: string;
  invoiceCode: string;
  date: string;
  customerName: string;
  totalAmount: number;
  status: "completed" | "draft";
  statusName: string;
  createdBy: string;
}

// Dòng sản phẩm trả hàng
export interface ReturnLineItem extends BaseLineItem {
  unitPrice: number;
  total: number;
  reason: string;
}

// Chi tiết đơn trả hàng
export interface ReturnDetail {
  id: string;
  code: string;
  date: string;
  originalInvoiceCode: string;
  status: "pending" | "completed" | "cancelled";
  statusName: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  customerPhone: string;
  items: ReturnLineItem[];
  totalReturnAmount: number;
  refundAmount: number;
  refundMethod: string;
  note?: string;
  createdBy: string;
  createdAt: string;
  timeline: StatusChange[];
}
