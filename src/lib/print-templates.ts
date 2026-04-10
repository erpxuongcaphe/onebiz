/**
 * Print template builders — each maps a domain entity to DocumentPrintData
 */

import type { DocumentPrintData } from "./print-document";
import type { InventoryCheck, DisposalExport, InternalExport, ManufacturingOrder } from "@/lib/types/products";
import type { PurchaseOrder, Invoice, SalesOrder } from "@/lib/types/orders";
import type { PurchaseReturn, PurchaseOrderEntry, InputInvoice } from "@/lib/types/suppliers";
import type { CashBookEntry } from "@/lib/types/finance";
import { formatCurrency, formatDate } from "@/lib/format";

export function buildInventoryCheckPrintData(row: InventoryCheck): DocumentPrintData {
  return {
    documentType: "PHIẾU KIỂM KHO",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: row.createdBy },
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
    createdBy: row.createdBy,
  };
}

export function buildDisposalPrintData(row: DisposalExport): DocumentPrintData {
  return {
    documentType: "PHIẾU XUẤT HỦY",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: row.createdBy },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Tổng sản phẩm", value: String(row.totalProducts) },
      { label: "Lý do", value: row.reason || "" },
    ],
    summaryRows: [
      { label: "Tổng giá trị", value: formatCurrency(row.totalAmount), bold: true },
    ],
    note: row.reason,
    createdBy: row.createdBy,
  };
}

export function buildInternalExportPrintData(row: InternalExport): DocumentPrintData {
  return {
    documentType: "PHIẾU XUẤT NỘI BỘ",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Người tạo", value: row.createdBy },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Tổng sản phẩm", value: String(row.totalProducts) },
    ],
    summaryRows: [
      { label: "Tổng giá trị", value: formatCurrency(row.totalAmount), bold: true },
    ],
    note: row.note,
    createdBy: row.createdBy,
  };
}

export function buildGoodsReceiptPrintData(row: PurchaseOrder): DocumentPrintData {
  return {
    documentType: "PHIẾU NHẬP HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Mã NCC", value: row.supplierCode || "" },
      { label: "Mã đặt hàng nhập", value: row.orderCode || "—" },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền hàng", value: formatCurrency(row.amountOwed) },
      { label: "Cần trả NCC", value: formatCurrency(row.amountOwed), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildProductionOrderPrintData(row: ManufacturingOrder): DocumentPrintData {
  return {
    documentType: "LỆNH SẢN XUẤT",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Sản phẩm", value: `${row.productCode} — ${row.productName}` },
      { label: "Số lượng", value: String(row.quantity) },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Chi phí sản xuất", value: formatCurrency(row.costAmount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildPurchaseReturnPrintData(row: PurchaseReturn): DocumentPrintData {
  return {
    documentType: "PHIẾU TRẢ HÀNG NHẬP",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Mã phiếu nhập", value: row.importCode },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền trả", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildInvoicePrintData(row: Invoice): DocumentPrintData {
  return {
    documentType: "HOÁ ĐƠN BÁN HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Khách hàng", value: row.customerName },
      { label: "Mã KH", value: row.customerCode },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền hàng", value: formatCurrency(row.totalAmount) },
      { label: "Chiết khấu", value: formatCurrency(row.discount) },
      { label: "Thanh toán", value: formatCurrency(row.totalAmount - row.discount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildSalesOrderPrintData(row: SalesOrder): DocumentPrintData {
  return {
    documentType: "ĐƠN ĐẶT HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Khách hàng", value: row.customerName },
      { label: "Điện thoại", value: row.customerPhone || "" },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildCashTransactionPrintData(row: CashBookEntry): DocumentPrintData {
  return {
    documentType: row.type === "receipt" ? "PHIẾU THU" : "PHIẾU CHI",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Loại", value: row.typeName || (row.type === "receipt" ? "Thu" : "Chi") },
      { label: "Danh mục", value: row.category || "" },
      { label: "Đối tượng", value: row.counterparty || "" },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Số tiền", value: formatCurrency(row.amount), bold: true },
    ],
    note: row.note,
    createdBy: row.createdBy,
  };
}

export function buildPurchaseEntryPrintData(row: PurchaseOrderEntry): DocumentPrintData {
  return {
    documentType: "ĐƠN ĐẶT HÀNG NHẬP",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Ngày dự kiến nhận", value: formatDate(row.expectedDate) },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền", value: formatCurrency(row.totalAmount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildInputInvoicePrintData(row: InputInvoice): DocumentPrintData {
  return {
    documentType: "HOÁ ĐƠN ĐẦU VÀO",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Nhà cung cấp", value: row.supplierName },
      { label: "Trạng thái", value: row.statusName || row.status },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tiền hàng", value: formatCurrency(row.totalAmount) },
      { label: "Thuế", value: formatCurrency(row.taxAmount) },
      { label: "Tổng", value: formatCurrency(row.totalAmount + row.taxAmount), bold: true },
    ],
    createdBy: row.createdBy,
  };
}

export function buildReturnPrintData(row: { code: string; date: string; customerName?: string; sellerName?: string; totalRefund: number; createdBy: string }): DocumentPrintData {
  return {
    documentType: "PHIẾU TRẢ HÀNG",
    documentCode: row.code,
    date: row.date,
    headerFields: [
      { label: "Khách hàng", value: row.customerName || "" },
      { label: "Người bán", value: row.sellerName || "" },
      { label: "Người tạo", value: row.createdBy },
    ],
    summaryRows: [
      { label: "Tổng tiền trả", value: formatCurrency(row.totalRefund), bold: true },
    ],
    createdBy: row.createdBy,
  };
}
