import type { StatusChange } from "./common";

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
  status: "pending" | "picking" | "shipping" | "delivered" | "failed" | "returned";
  statusName: string;
  fee: number;
  cod: number;
  createdAt: string;
}

// Chi tiết đơn giao hàng
export interface ShippingOrderDetail {
  id: string;
  code: string;
  trackingCode: string;
  date: string;
  status: "pending" | "picked_up" | "in_transit" | "delivered" | "failed";
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
