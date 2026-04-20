/**
 * Excel schema: Đơn bán nội bộ (internal sales)
 *
 * Multi-line: mỗi row = 1 dòng hàng. Các row cùng "Mã đơn" gộp thành 1 đơn.
 *
 * Đơn bán nội bộ = chi nhánh A bán cho chi nhánh B — tạo đồng thời:
 *  - invoice (bên bán) có source='internal'
 *  - input_invoice (bên mua)
 *  - internal_sales header + items link 2 phiếu
 *  - stock out ở fromBranch + stock in ở toBranch
 *
 * fromBranchCode và toBranchCode BẮT BUỘC khác nhau.
 * Trạng thái khởi tạo: 'completed' (bán-mua đồng thời, không có draft).
 */

import type { ExcelSchema } from "../types";

export interface InternalSaleImportRow {
  /** Mã đơn — các row cùng mã gộp thành 1 đơn */
  code: string;
  /** Mã chi nhánh bán (resolve sang from_branch_id) */
  fromBranchCode: string;
  /** Mã chi nhánh mua (resolve sang to_branch_id) */
  toBranchCode: string;
  /** Ghi chú header (chỉ lấy từ row đầu) */
  note?: string;
  /** Phương thức thanh toán giữa 2 chi nhánh: cash|transfer|debt. Bỏ trống = ghi nợ (debt) */
  paymentMethod?: "cash" | "transfer" | "debt";
  /** Mã SP trong dòng hàng */
  productCode: string;
  /** Số lượng */
  quantity: number;
  /** Đơn giá bán nội bộ (trước VAT) */
  unitPrice: number;
  /** VAT % (0-100). Bỏ trống = 0 */
  vatRate?: number;
}

export const internalSaleExcelSchema: ExcelSchema<InternalSaleImportRow> = {
  name: "Đơn bán nội bộ",
  fileName: "Don-ban-noi-bo",
  description:
    "Nhập đơn bán nội bộ (chi nhánh A → chi nhánh B) hàng loạt. Mỗi dòng = 1 dòng hàng. Các dòng cùng 'Mã đơn' gộp thành 1 đơn. Hệ thống sẽ tự tạo cả 2 phiếu (invoice bên bán + input_invoice bên mua) và chuyển kho tương ứng.",
  columns: [
    {
      key: "code",
      header: "Mã đơn",
      type: "string",
      required: true,
      maxLength: 50,
      example: "IS000001",
      description: "Mã đơn — các dòng cùng mã gộp thành 1 đơn",
      width: 14,
    },
    {
      key: "fromBranchCode",
      header: "Chi nhánh bán",
      type: "string",
      required: true,
      maxLength: 50,
      example: "KHO",
      description: "Mã chi nhánh xuất hàng",
      width: 14,
    },
    {
      key: "toBranchCode",
      header: "Chi nhánh mua",
      type: "string",
      required: true,
      maxLength: 50,
      example: "QUAN01",
      description: "Mã chi nhánh nhận hàng (phải khác chi nhánh bán)",
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
      example: 10,
      width: 12,
    },
    {
      key: "unitPrice",
      header: "Đơn giá",
      type: "number",
      required: true,
      min: 0,
      example: 20000,
      description: "Đơn giá bán nội bộ (trước VAT)",
      width: 14,
    },
    {
      key: "vatRate",
      header: "VAT (%)",
      type: "number",
      min: 0,
      max: 100,
      example: 8,
      width: 10,
    },
    {
      key: "paymentMethod",
      header: "Thanh toán",
      type: "enum",
      enumValues: ["cash", "transfer", "debt"] as const,
      enumLabels: {
        cash: "Tiền mặt",
        transfer: "Chuyển khoản",
        debt: "Ghi nợ",
      },
      description: "Bỏ trống = debt (ghi công nợ giữa 2 chi nhánh)",
      width: 14,
    },
    {
      key: "note",
      header: "Ghi chú đơn",
      type: "string",
      maxLength: 500,
      description: "Ghi chú header — chỉ lấy từ row đầu tiên của mỗi mã đơn",
      width: 40,
    },
  ],
  validateRow: (row, _index, allRows) => {
    if (row.fromBranchCode === row.toBranchCode) {
      return `Đơn "${row.code}": chi nhánh bán và mua không được trùng nhau`;
    }
    const sameCode = allRows.filter((r) => r.code === row.code);
    if (sameCode.length > 1) {
      const first = sameCode[0];
      if (first.fromBranchCode !== row.fromBranchCode) {
        return `Đơn "${row.code}": chi nhánh bán khác nhau giữa các dòng`;
      }
      if (first.toBranchCode !== row.toBranchCode) {
        return `Đơn "${row.code}": chi nhánh mua khác nhau giữa các dòng`;
      }
    }
    return null;
  },
};
