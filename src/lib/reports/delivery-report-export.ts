import type { ShipperOrderRow } from "@/lib/services/supabase/fnb-analytics";
import type { ExcelSheet } from "@/lib/utils/excel-export";

export const DELIVERY_TIER_LABELS: Record<string, string> = {
  near: "Gần", mid: "Vừa", far: "Xa", custom: "Tự nhập",
};

export function deliveryDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", hour12: false,
  });
}

export function deliveryDetailRow(staffName: string, order: ShipperOrderRow) {
  return {
    staffName,
    orderNumber: order.orderNumber,
    invoiceCode: order.invoiceCode ?? "",
    customerName: order.customerName,
    total: order.invoiceId ? order.total : "",
    deliveryFee: order.deliveryFee,
    tier: order.deliveryTier ? DELIVERY_TIER_LABELS[order.deliveryTier] ?? order.deliveryTier : "",
    createdAt: deliveryDateTime(order.createdAt),
    assignedAt: deliveryDateTime(order.assignedAt),
    completedAt: deliveryDateTime(order.completedAt),
    duration: order.durationSeconds ?? "",
    status: order.completedAt ? "Đã giao" : order.assignedAt ? "Đang giao" : "Chưa ghi nhận nhận giao",
  };
}

export const DELIVERY_DETAIL_COLUMNS: ExcelSheet["columns"] = [
  { label: "Nhân viên giao", key: "staffName", width: 28 },
  { label: "Mã đơn", key: "orderNumber", width: 18 },
  { label: "Mã hóa đơn", key: "invoiceCode", width: 18 },
  { label: "Khách hàng", key: "customerName", width: 28 },
  { label: "Giá trị hóa đơn (VND)", key: "total", width: 22, format: "currency" },
  { label: "Phí giao trên đơn (VND)", key: "deliveryFee", width: 24, format: "currency" },
  { label: "Cự ly", key: "tier", width: 14 },
  { label: "Tạo đơn lúc", key: "createdAt", width: 24 },
  { label: "Nhận giao lúc", key: "assignedAt", width: 24 },
  { label: "Hoàn tất lúc", key: "completedAt", width: 24 },
  { label: "Thời gian giao (giây)", key: "duration", width: 22, format: "number" },
  { label: "Trạng thái giao", key: "status", width: 28 },
];
