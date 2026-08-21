import type { BaseLineItem, StatusChange } from "./common";

// Mục trong danh sách hóa đơn
export interface Invoice {
  id: string;
  code: string;
  /** Mã đơn gốc (DH đặt hàng / NH nháp) trước khi hoàn tất — truy vết (00169). */
  orderCode?: string;
  date: string;
  returnCode?: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  /** SĐT khách (join customers.phone) — in trên phiếu nếu có. */
  customerPhone?: string;
  /** Địa chỉ khách (join customers.address) — in trên phiếu nếu có. */
  customerAddress?: string;
  /**
   * Dư nợ HIỆN TẠI của khách (join customers.debt, thời gian thực).
   * Dùng in khối công nợ: Nợ cũ = currentDebt − debt(HĐ này); Còn nợ = currentDebt.
   * undefined khi đơn không gắn khách (khách lẻ).
   */
  customerCurrentDebt?: number;
  totalAmount: number;
  discount: number;
  /** Phí giao hàng (invoices.shipping_fee). Đã gộp trong totalAmount = grand total. */
  shippingFee: number;
  taxAmount: number;
  paid: number;
  /** 00179: tiền khách đưa thực tế tại POS (>= paid khi có thối). undefined = không ghi nhận. */
  amountTendered?: number;
  debt: number;
  status: "processing" | "completed" | "cancelled" | "delivery_failed";
  /**
   * BATCH 3R: tổng tiền đã trả hàng của HĐ này (SUM sales_returns.total,
   * status='completed'). Dùng suy ra badge "Đã trả 1 phần"/"Đã trả toàn bộ"
   * ngoài danh sách. undefined = chưa load / không có phiếu trả.
   */
  returnedAmount?: number;
  /** Tên chi nhánh ghi nhận hóa đơn (resolved từ branches.name). */
  branchName?: string;
  /** Branch UUID để filter / drill-down. */
  branchId?: string;
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
  /** Ghi chú người bán (invoices.note) — in trên hóa đơn (CEO 08/07). */
  note?: string;
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
  /** Chi nhánh của phiếu — dùng resolve mẫu in theo chi nhánh (CEO 05/07). */
  branchId?: string;
  /** 06/08: ghi chú phiếu nhập — panel chi tiết từng đặt textarea trần nên không hiện. */
  note?: string;
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
  /** Mã ĐƠN gốc hiển thị (DH — giữ nguyên cả sau khi hoàn tất). */
  code: string;
  /** Mã hóa đơn thật (HD) khi đơn đã hoàn tất — để đối chiếu/mở hóa đơn. */
  invoiceCode?: string;
  date: string;
  customerName: string;
  customerId?: string;
  customerPhone: string;
  totalAmount: number;
  /**
   * Phí giao hàng (invoices.shipping_fee). Đơn đặt hàng = hóa đơn nháp nên
   * totalAmount đã gộp ship (= tiền hàng + phí giao). undefined/0 = không có ship.
   */
  shippingFee?: number;
  /** Số khách đã trả (invoices.paid). Đơn hoàn thành = đã trả đủ. */
  paid?: number;
  /** Số còn phải thu (invoices.debt). Dùng cho thẻ "Tổng cần thu". */
  debt?: number;
  status: "draft" | "new" | "confirmed" | "delivering" | "completed" | "cancelled";
  statusName: string;
  /**
   * CEO 14/07: đơn đã được xuất thành hóa đơn RIÊNG này (bug "Xử lý đặt hàng"
   * hoặc ca đơn≠hóa đơn). Có giá trị ⇒ hiện "Đã xuất hóa đơn", KHÔNG tính là
   * lần bán riêng (giữ status cũ nên báo cáo đếm 'completed' bỏ qua).
   */
  fulfilledById?: string;
  /** Mã hóa đơn đã xuất (HD…) để hiện + đối chiếu. */
  fulfilledInvoiceCode?: string;
  /**
   * 00331/00337 — SỐ ĐƠN BÁN CON ĐÃ THANH TOÁN và còn hiệu lực (không nháp,
   * không huỷ, không void, không xoá mềm).
   *
   * Vì sao cần: một đơn đặt hàng được phép tạo KHÔNG GIỚI HẠN đơn bán con, nên
   * "đã có hóa đơn" và "đã hoàn tất xử lý" là hai việc khác nhau. Đơn có hóa
   * đơn nhưng chưa gắn (fulfilled_by_id null) phải hiện "Đang xử lý", KHÔNG
   * được gọi là "Chờ xử lý".
   *
   * `undefined` = máy chủ chưa trả (chưa chạy migration cột) ⇒ màn quay về mô
   * hình hai mức cũ thay vì đoán bừa.
   */
  completedChildCount?: number;
  /** Ghi chú người bán (invoices.note) — in trên phiếu đặt hàng (CEO 08/07). */
  note?: string;
  createdBy: string;
  createdByName?: string;
  /** Chi nhánh ghi nhận đơn (resolved từ branches.name). */
  branchId?: string;
  branchName?: string;
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
  invoiceId?: string;
  date: string;
  customerCode?: string;
  customerName: string;
  customerPhone?: string;
  totalAmount: number;
  refundedAmount: number;
  status: "draft" | "confirmed" | "completed" | "cancelled";
  statusName: string;
  createdById?: string;
  createdBy: string;
  /** Chi nhánh ghi nhận phiếu trả (resolved từ branches.name). */
  branchId?: string;
  branchName?: string;
  reason?: string;
  /** 06/08: ghi chú phiếu trả — panel chi tiết từng đặt textarea trần nên không hiện. */
  note?: string;
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
