/**
 * Excel schema: Giao dịch sổ quỹ (cash transactions)
 *
 * Dùng để nhập dữ liệu sổ quỹ từ file Excel (VD import data tháng cũ
 * trước khi dùng hệ thống).
 */

import type { ExcelSchema } from "../types";

export interface CashTransactionImportRow {
  code: string;
  date: Date;
  type: "receipt" | "payment";
  category: string;
  amount: number;
  counterparty?: string;
  paymentMethod?: "cash" | "transfer" | "card";
  note?: string;
  branchCode?: string;
}

export const cashTransactionExcelSchema: ExcelSchema<CashTransactionImportRow> = {
  name: "Giao dịch sổ quỹ",
  fileName: "So-quy",
  description:
    "Nhập bút toán thu/chi hàng loạt. 'Thu/Chi' dùng để phân loại dòng tiền. 'Đối tác' là khách / NCC / NV liên quan (có thể trống nếu nội bộ).",
  columns: [
    {
      key: "code",
      header: "Mã phiếu",
      type: "string",
      required: true,
      unique: true,
      maxLength: 50,
      example: "PT00001",
      description: "Mã phiếu thu/chi, duy nhất trong hệ thống",
      width: 14,
    },
    {
      key: "date",
      header: "Ngày phát sinh",
      type: "date",
      required: true,
      example: "2026-04-19",
      width: 16,
    },
    {
      key: "type",
      header: "Loại",
      type: "enum",
      required: true,
      enumValues: ["receipt", "payment"] as const,
      enumLabels: {
        receipt: "Thu",
        payment: "Chi",
      },
      example: "receipt",
      width: 10,
    },
    {
      key: "category",
      header: "Nhóm bút toán",
      type: "string",
      required: true,
      maxLength: 100,
      example: "Bán hàng",
      description: "VD: Bán hàng, Mua hàng, Chi phí văn phòng, Lương NV...",
      width: 20,
    },
    {
      key: "amount",
      header: "Số tiền",
      type: "number",
      required: true,
      min: 0,
      example: 1500000,
      description: "Luôn là số dương (loại Thu/Chi đã quy định dấu)",
      width: 16,
    },
    {
      key: "counterparty",
      header: "Đối tác",
      type: "string",
      maxLength: 200,
      description: "Tên khách hàng / NCC / nhân viên liên quan",
      width: 24,
    },
    {
      key: "paymentMethod",
      header: "Phương thức",
      type: "enum",
      enumValues: ["cash", "transfer", "card"] as const,
      enumLabels: {
        cash: "Tiền mặt",
        transfer: "Chuyển khoản",
        card: "Quẹt thẻ",
      },
      example: "cash",
      width: 14,
    },
    {
      key: "branchCode",
      header: "Mã chi nhánh",
      type: "string",
      maxLength: 50,
      description:
        "Mã chi nhánh phát sinh giao dịch. Bỏ trống = chi nhánh hiện tại đang chọn",
      width: 14,
    },
    {
      key: "note",
      header: "Ghi chú",
      type: "string",
      maxLength: 500,
      width: 40,
    },
  ],
};
