/**
 * Print template builders — each maps a domain entity to DocumentPrintData
 */

import type { DocumentPrintData, DocumentLineItem } from "./print-document";
import type { InventoryCheck, DisposalExport, InternalExport, ManufacturingOrder } from "@/lib/types/products";
import type { PurchaseOrder, Invoice, SalesOrder } from "@/lib/types/orders";
import type { PurchaseReturn, PurchaseOrderEntry, InputInvoice } from "@/lib/types/suppliers";
import type { CashBookEntry } from "@/lib/types/finance";
import { formatCurrency as fmtNum, formatDate, formatUser } from "@/lib/format";

/**
 * Tiền hiển thị trên phiếu in: số có phân tách nghìn + hậu tố " đ".
 * Dùng ASCII "đ" (U+0111) — máy in nhiệt nào cũng có font, KHÔNG dùng ₫ (U+20AB).
 * Wrap đè tên `formatCurrency` để mọi dòng tiền (summaryRows) tự kèm "đ";
 * các ô đếm số lượng dùng String(...) nên không bị ảnh hưởng.
 */
const formatCurrency = (n: number | null | undefined) => `${fmtNum(n)} đ`;

/** Cột bảng hàng chuẩn cho chứng từ bán/nhập (Mã · Tên · SL · Đơn giá · Thành tiền). */
const SALE_ITEM_COLUMNS = ["Mã hàng", "Tên hàng", "SL", "Đơn giá", "Thành tiền"];
// Phiếu phía MUA (nhập/đặt NCC/HĐ đầu vào/trả NCC): "Đơn giá nhập" cho rõ ngữ cảnh.
const PURCHASE_ITEM_COLUMNS = ["Mã hàng", "Tên hàng", "SL", "Đơn giá nhập", "Thành tiền"];

/**
 * Chuẩn hoá các dòng hàng (đã nạp từ service) → DocumentLineItem để in.
 * Nhận field tên kiểu nào cũng được (productCode/code, productName/name…).
 * CHỦ ĐÍCH bỏ cột giảm-giá-dòng: giảm đã gộp vào "Thành tiền", giúp bảng in
 * luôn đủ 5 cột thẳng hàng (template render ô giảm theo từng dòng → dễ lệch).
 */
export function toPrintLines(
  rows: Array<{
    productCode?: string;
    code?: string;
    productName?: string;
    name?: string;
    quantity: number;
    unit?: string;
    unitPrice?: number;
    price?: number;
    // thành tiền dòng — service đặt tên khác nhau: total / lineTotal / amount
    total?: number;
    lineTotal?: number;
    amount?: number;
  }>,
): DocumentLineItem[] {
  return rows.map((r) => ({
    code: r.productCode ?? r.code ?? "",
    name: r.productName ?? r.name ?? "",
    quantity: r.quantity,
    unit: r.unit,
    unitPrice: r.unitPrice ?? r.price ?? 0,
    total: r.total ?? r.lineTotal ?? r.amount ?? 0,
  }));
}

export function buildInventoryCheckPrintData(row: InventoryCheck): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU KIỂM KHO",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: user },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Tổng sản phẩm", value: String(row.totalProducts) },
    ],
    summaryRows: [
      { label: "SL lệch tăng", value: String(row.increaseQty) },
      { label: "SL lệch giảm", value: String(row.decreaseQty) },
      { label: "GT tăng", value: formatCurrency(row.increaseAmount) },
      { label: "GT giảm", value: formatCurrency(row.decreaseAmount) },
      { label: "Tổng chênh lệch", value: formatCurrency(row.increaseAmount - row.decreaseAmount), bold: true },
    ],
    note: row.note,
    createdBy: user,
  };
}

export function buildDisposalPrintData(row: DisposalExport): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU XUẤT HỦY",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: user },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Tổng sản phẩm", value: String(row.totalProducts) },
      { label: "Lý do", value: row.reason || "" },
    ],
    summaryRows: [
      { label: "Tổng giá trị", value: formatCurrency(row.totalAmount), bold: true },
    ],
    note: row.reason,
    createdBy: user,
  };
}

/**
 * Print template cho phiếu Bán nội bộ — Sprint UX-1 Stage 4 (CEO 04/05/2026).
 * Anomaly fix: trước đây ban-noi-bo thiếu "In phiếu" trong row actions.
 */
export function buildInternalSalePrintData(row: {
  code: string;
  createdAt: string;
  fromBranchName?: string;
  toBranchName?: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  note?: string;
  createdBy?: string;
  createdByName?: string;
}, items?: DocumentLineItem[]): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU BÁN NỘI BỘ",
    documentCode: row.code,
    date: row.createdAt,
    headerFields: [
      { label: "Bên bán", value: row.fromBranchName || "—" },
      { label: "Bên mua", value: row.toBranchName || "—" },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: SALE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tạm tính", value: formatCurrency(row.subtotal) },
      { label: "Thuế VAT", value: formatCurrency(row.taxAmount) },
      { label: "Tổng cộng", value: formatCurrency(row.total), bold: true },
    ],
    note: row.note,
    createdBy: user,
  };
}

export function buildInternalExportPrintData(row: InternalExport): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU XUẤT NỘI BỘ",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: user },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Tổng sản phẩm", value: String(row.totalProducts) },
    ],
    summaryRows: [
      { label: "Tổng giá trị", value: formatCurrency(row.totalAmount), bold: true },
    ],
    note: row.note,
    createdBy: user,
  };
}

export function buildGoodsReceiptPrintData(
  row: PurchaseOrder,
  items?: DocumentLineItem[],
): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU NHẬP HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Mã NCC", value: row.supplierCode || "" },
      { label: "Mã đặt hàng nhập", value: row.orderCode || "—" },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: PURCHASE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tổng tiền hàng", value: formatCurrency(row.amountOwed) },
      { label: "Cần trả NCC", value: formatCurrency(row.amountOwed), bold: true },
    ],
    createdBy: user,
  };
}

export function buildProductionOrderPrintData(row: ManufacturingOrder): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "LỆNH SẢN XUẤT",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Sản phẩm", value: `${row.productCode} — ${row.productName}` },
      { label: "Số lượng", value: String(row.quantity) },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: user },
    ],
    summaryRows: [
      { label: "Chi phí sản xuất", value: formatCurrency(row.costAmount), bold: true },
    ],
    createdBy: user,
  };
}

export function buildPurchaseReturnPrintData(
  row: PurchaseReturn,
  items?: DocumentLineItem[],
): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "PHIẾU TRẢ HÀNG NHẬP",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Mã phiếu nhập", value: row.importCode },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: PURCHASE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tổng tiền trả", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: user,
  };
}

export function buildInvoicePrintData(
  row: Invoice,
  business?: TenantBusinessInfoForPrint,
  items?: DocumentLineItem[],
): DocumentPrintData {
  // Invoice.createdBy already written as full_name by invoices.ts mapper
  const user = formatUser(undefined, row.createdBy);
  // CEO 24/06: bật/tắt từng dòng. undefined = bật (mặc định, tương thích cũ).
  const f = business?.invoiceFields ?? {};
  const on = (v?: boolean) => v !== false;

  // Bên mua — mỗi dòng theo cờ + chỉ thêm khi có dữ liệu.
  const headerFields: { label: string; value: string }[] = [];
  if (on(f.customerName))
    headerFields.push({ label: "Khách hàng", value: row.customerName });
  if (on(f.customerCode))
    headerFields.push({ label: "Mã KH", value: row.customerCode });
  if (on(f.customerPhone) && row.customerPhone)
    headerFields.push({ label: "Điện thoại", value: row.customerPhone });
  if (on(f.customerAddress) && row.customerAddress)
    headerFields.push({ label: "Địa chỉ", value: row.customerAddress });
  if (on(f.createdBy)) headerFields.push({ label: "Người tạo", value: user });

  // Khối tổng tiền + công nợ.
  const due = row.totalAmount - row.discount; // phải trả của RIÊNG hoá đơn này
  const currentDebt = row.customerCurrentDebt; // dư nợ hiện tại (thời gian thực)
  const oldDebt = currentDebt != null ? currentDebt - row.debt : 0; // nợ trước HĐ này
  // Chỉ in khối nợ khi bật cờ + khách công nợ/bán sỉ (có gắn KH + có dư nợ).
  const showDebt =
    on(f.debt) &&
    !!row.customerId &&
    currentDebt != null &&
    (currentDebt > 0 || oldDebt > 0);

  const summaryRows: { label: string; value: string; bold?: boolean }[] = [
    { label: "Tổng tiền hàng", value: formatCurrency(row.totalAmount) },
  ];
  if (row.discount > 0)
    summaryRows.push({ label: "Chiết khấu", value: formatCurrency(row.discount) });
  summaryRows.push({ label: "Tổng cộng", value: formatCurrency(due), bold: true });
  if (showDebt || row.paid > 0)
    summaryRows.push({ label: "Khách thanh toán", value: formatCurrency(row.paid) });
  if (showDebt) {
    summaryRows.push({ label: "Nợ cũ", value: formatCurrency(oldDebt) });
    summaryRows.push({
      label: "Còn nợ",
      value: formatCurrency(currentDebt ?? 0),
      bold: true,
    });
  }

  return {
    // CEO 24/06: tiêu đề đặt ở cài đặt; mặc định "PHIẾU THANH TOÁN" (đây là
    // chứng từ nội bộ, KHÔNG phải hoá đơn GTGT/hoá đơn đỏ).
    documentType: business?.invoiceTitle || "PHIẾU THANH TOÁN",
    documentCode: row.code,
    date: row.date,
    // Bên bán — mỗi dòng theo cờ bật/tắt (tắt = không truyền → template ẩn).
    branchName: on(f.branch) ? row.branchName : undefined,
    businessName: on(f.businessName) ? business?.businessName : undefined,
    businessTaxCode: on(f.taxCode) ? business?.taxCode : undefined,
    businessAddress: on(f.address) ? business?.address : undefined,
    businessPhone: on(f.phone) ? business?.phone : undefined,
    businessLogoUrl: on(f.logo) ? business?.logoUrl : undefined,
    businessFooter: on(f.footer) ? business?.invoiceFooter : undefined,
    headerFields,
    ...(items && items.length
      ? { items, itemColumns: SALE_ITEM_COLUMNS }
      : {}),
    summaryRows,
    showSignature: on(f.signature),
    createdBy: user,
  };
}

/**
 * Subset của TenantBusinessInfo dùng cho print template — tránh import
 * service vào print-templates (giữ pure).
 */
export interface TenantBusinessInfoForPrint {
  businessName?: string;
  taxCode?: string;
  address?: string;
  phone?: string;
  logoUrl?: string;
  invoiceFooter?: string;
  /** Tiêu đề phiếu (vd "PHIẾU THANH TOÁN"). Trống → mặc định trong builder. */
  invoiceTitle?: string;
  /** Bật/tắt từng dòng thông tin trên phiếu bán (CEO toàn quyền). */
  invoiceFields?: InvoiceFieldFlags;
}

/**
 * Cờ bật/tắt từng dòng thông tin trên phiếu bán hàng.
 * undefined / không set = BẬT (mặc định, giữ nguyên hành vi cũ).
 * Chỉ ẩn khi giá trị === false.
 */
export interface InvoiceFieldFlags {
  // ── Bên bán ──
  logo?: boolean;
  businessName?: boolean;
  taxCode?: boolean;
  address?: boolean;
  phone?: boolean;
  branch?: boolean;
  // ── Bên mua ──
  customerName?: boolean;
  customerCode?: boolean;
  customerPhone?: boolean;
  customerAddress?: boolean;
  // ── Khác ──
  createdBy?: boolean;
  signature?: boolean;
  debt?: boolean;
  footer?: boolean;
}

export function buildSalesOrderPrintData(
  row: SalesOrder,
  items?: DocumentLineItem[],
): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "ĐƠN ĐẶT HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Khách hàng", value: row.customerName },
      { label: "Điện thoại", value: row.customerPhone || "" },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: SALE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tổng tiền", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: user,
  };
}

export function buildCashTransactionPrintData(row: CashBookEntry): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: row.type === "receipt" ? "PHIẾU THU" : "PHIẾU CHI",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Loại", value: row.typeName || (row.type === "receipt" ? "Thu" : "Chi") },
      { label: "Danh mục", value: row.category || "" },
      { label: "Đối tượng", value: row.counterparty || "" },
      { label: "Người tạo", value: user },
    ],
    summaryRows: [
      { label: "Số tiền", value: formatCurrency(row.amount), bold: true },
    ],
    note: row.note,
    createdBy: user,
  };
}

export function buildPurchaseEntryPrintData(
  row: PurchaseOrderEntry,
  items?: DocumentLineItem[],
): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "ĐƠN ĐẶT HÀNG NHẬP",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Ngày dự kiến nhận", value: formatDate(row.expectedDate) },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: PURCHASE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tổng tiền", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: user,
  };
}

export function buildInputInvoicePrintData(
  row: InputInvoice,
  items?: DocumentLineItem[],
): DocumentPrintData {
  const user = formatUser(row.createdByName, row.createdBy);
  return {
    documentType: "HOÁ ĐƠN ĐẦU VÀO",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: PURCHASE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tiền hàng", value: formatCurrency(row.totalAmount) },
      { label: "Thuế", value: formatCurrency(row.taxAmount) },
      { label: "Tổng", value: formatCurrency(row.totalAmount + row.taxAmount), bold: true },
    ],
    createdBy: user,
  };
}

export function buildReturnPrintData(
  row: { code: string; date: string; customerName?: string; sellerName?: string; totalRefund: number; createdBy: string },
  items?: DocumentLineItem[],
): DocumentPrintData {
  // row.createdBy already resolved to full_name by returns.ts mapper
  const user = formatUser(undefined, row.createdBy);
  return {
    documentType: "PHIẾU TRẢ HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Khách hàng", value: row.customerName || "" },
      { label: "Người bán", value: row.sellerName || "" },
      { label: "Người tạo", value: user },
    ],
    ...(items && items.length ? { items, itemColumns: SALE_ITEM_COLUMNS } : {}),
    summaryRows: [
      { label: "Tổng tiền trả", value: formatCurrency(row.totalRefund), bold: true },
    ],
    createdBy: user,
  };
}
