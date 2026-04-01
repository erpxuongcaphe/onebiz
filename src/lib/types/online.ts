// Kênh bán hàng trực tuyến
export interface SalesChannel {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  ordersToday: number;
  revenueToday: number;
}

// Đơn hàng online
export interface OnlineOrder {
  id: string;
  code: string;
  channel: string;
  channelColor: string;
  customerName: string;
  totalAmount: number;
  status: "pending" | "confirmed" | "shipping" | "completed" | "cancelled";
  statusName: string;
  date: string;
}
