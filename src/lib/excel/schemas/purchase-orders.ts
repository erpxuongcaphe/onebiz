/**
 * Excel schema: Đơn nhập hàng (purchase orders)
 *
 * Multi-line: mỗi row Excel = 1 dòng hàng trong đơn.
 * Các dòng cùng "Mã đơn" (code) sẽ gộp thành 1 đơn khi import.
 *
 * Header fields (code, supplierCode, branchCode, note) phải giống hệt nhau
 * trong tất cả các dòng cùng mã đơn — validate cross-row báo lỗi nếu lệch.
 *
 * Trạng thái import: luôn là `draft` — user vào trang Đặt hàng nhập
 * để duyệt (confirm) → chuyển sang `ordered` rồi mới nhận hàng (receive).
 */

import type { ExcelSchema } from "../types";

/** Shape của 1 row Excel (= 1 line item) trước khi group theo mã đơn. */
export interface PurchaseOrderImportRow {
  /** Mã đơn — các row cùng mã gộp thành 1 đơn */
  code: string;
  /** Mã NCC (resolve sang supplier_id) */
  supplierCode: string;
  /** Mã chi nhánh (resolve sang branch_id). Bỏ trống = chi nhánh hiện tại */
  branchCode?: string;
  /** Ghi chú header của đơn (chỉ lấy từ row đầu tiên của mỗi mã đơn) */
  note?: string;
  /** Mã SP trong dòng hàng */
  productCode: string;
  /** Số lượng đặt */
  quantity: number;
  /** Đơn giá nhập */
  unitPrice: number;
  /** Chiết khấu dòng (VND). Bỏ trống = 0 */
  discount?: number;
  /** VAT % (0-100). Bỏ trống = 0 */
  vatRate?: number;
}

export const purchaseOrderExcelSchema: ExcelSchema<PurchaseOrderImportRow> = {
  name: "Đơn nhập hàng",
  fileName: "Don-nhap-hang",
  description:
    "Nhập đơn đặt hàng NCC hàng loạt. Mỗi dòng Excel = 1 dòng hàng trong đơn. Các dòng CÙNG 'Mã đơn' sẽ được gộp thành 1 đơn duy nhất. NCC và chi nhánh phải đã tồn tại trong hệ thống. Đơn tạo ra có trạng thái 'Nháp' — vào trang Đặt hàng nhập để duyệt rồi nhận hàng.",
  columns: [
    {
      key: "code",
      header: "Mã đơn",
      type: "string",
      required: true,
      maxLength: 50,
      example: "PO000001",
      description: "Mã đơn nhập — các dòng cùng mã gộp thành 1 đơn",
      width: 14,
    },
    {
      key: "supplierCode",
      header: "Mã NCC",
      type: "string",
      required: true,
      maxLength: 50,
      example: "NCC001",
      description: "Mã nhà cung cấp — phải đã tồn tại trong hệ thống",
      width: 14,
    },
    {
      key: "branchCode",
      header: "Mã chi nhánh",
      type: "string",
      maxLength: 50,
      description: "Bỏ trống = chi nhánh hiện tại đang chọn",
      width: 14,
    },
    {
      key: "productCode",
      header: "Mã SP",
      type: "string",
      required: true,
      maxLength: 50,
      example: "CF001",
      description: "Mã sản phẩm — phải đã tồn tại",
      width: 14,
    },
    {
      key: "quantity",
      header: "Số lượng",
      type: "number",
      required: true,
      min: 0,
      example: 100,
      width: 12,
    },
    {
      key: "unitPrice",
      header: "Đơn giá",
      type: "number",
      required: true,
      min: 0,
      example: 15000,
      description: "Đơn giá nhập trước VAT",
      width: 14,
    },
    {
      key: "discount",
      header: "Chiết khấu",
      type: "number",
      min: 0,
      example: 0,
      description: "Chiết khấu dòng (VND). Bỏ trống = 0",
      width: 12,
    },
    {
      key: "vatRate",
      header: "VAT (%)",
      type: "number",
      min: 0,
      max: 100,
      example: 8,
      description: "Thuế VAT đầu vào — 0, 5, 8 hoặc 10",
      width: 10,
    },
    {
      key: "note",
      header: "Ghi chú đơn",
      type: "string",
      maxLength: 500,
      description: "Ghi chú header — chỉ lấy giá trị từ row đầu tiên của mỗi mã đơn",
      width: 40,
    },
  ],
  validateRow: (row, _index, allRows) => {
    // Các row cùng code phải có cùng supplierCode + branchCode
    const sameCode = allRows.filter((r) => r.code === row.code);
    if (sameCode.length > 1) {
      const first = sameCode[0];
      if (first.supplierCode !== row.supplierCode) {
        return `Đơn "${row.code}" có NCC khác nhau giữa các dòng — một đơn chỉ 1 NCC`;
      }
      if ((first.branchCode ?? "") !== (row.branchCode ?? "")) {
        return `Đơn "${row.code}" có chi nhánh khác nhau giữa các dòng — một đơn chỉ 1 chi nhánh`;
      }
      // Trùng SP trong cùng đơn → cảnh báo (hợp lý khi nhập 2 lot cùng SP khác giá)
      // Không block nhưng user nên tự gộp cho sạch
    }
    return null;
  },
};
