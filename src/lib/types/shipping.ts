import type { StatusChange } from "./common";

/**
 * Trạng thái giao hàng (vận đơn) — khớp 1-1 với DB enum trong
 * `shipping_orders.status` (00001_initial_schema.sql):
 *
 *   pending     — chờ shipper đến lấy hàng
 *   picked_up   — shipper đã lấy hàng rời kho (cam kết nhận)
 *   in_transit  — đang trên đường giao
 *   delivered   — đã giao tới khách
 *   returned    — khách từ chối / giao thất bại → hoàn về
 *   cancelled   — huỷ vận đơn trước khi giao
 *
 * Trước đây frontend đổi tên một số state (picking/shipping/failed)
 * — nay thống nhất với DB để tránh nhầm lẫn + bật đủ 4 mốc
 * lifecycle (pending → picked_up → in_transit → delivered).
 */
export type ShippingStatus =
  | "pending"
  | "picked_up"
  | "in_transit"
  | "delivered"
  | "returned"
  | "cancelled";

// Đối tác vận chuyển
export interface DeliveryPartner {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  activeOrders: number;
  completedOrders: number;
  status: "active" | "inactive";
  statusName: string;
  createdAt: string;
}

// Đơn giao hàng trong danh sách
export interface ShippingOrder {
  id: string;
  code: string;
  invoiceCode: string;
  deliveryPartner: string;
  customerName: string;
  customerPhone: string;
  address: string;
  status: ShippingStatus;
  statusName: string;
  fee: number;
  cod: number;
  createdAt: string;
  /**
   * Timestamp nhánh đổi trạng thái lần gần nhất — dùng để hiển thị
   * "thời gian giao" (delivered_at) hoặc "thời gian lấy hàng" (picked_up_at)
   * trên bảng / báo cáo KPI.
   */
  updatedAt?: string;
}

// Chi tiết đơn giao hàng
export interface ShippingOrderDetail {
  id: string;
  code: string;
  trackingCode: string;
  date: string;
  status: ShippingStatus;
  statusName: string;
  deliveryPartner: string;
  deliveryPartnerPhone: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string;
  senderName: string;
  senderPhone: string;
  senderAddress: string;
  linkedInvoiceCode: string;
  codAmount: number;
  shippingFee: number;
  weight: number;
  note?: string;
  estimatedDelivery: string;
  createdBy: string;
  createdAt: string;
  timeline: StatusChange[];
}
