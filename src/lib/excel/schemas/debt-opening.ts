/**
 * Excel schema: Công nợ đầu kỳ khách / NCC (debt opening balance)
 *
 * Dùng 1 LẦN khi onboard hệ thống: nhập công nợ khách / NCC tại ngày khởi tạo.
 * Sau đó công nợ được tính từ invoice/purchase-order thực tế.
 */

import type { ExcelSchema } from "../types";

export interface DebtOpeningImportRow {
  partyType: "customer" | "supplier";
  partyCode: string;
  partyName?: string; // chỉ để reference, không ghi vào DB
  openingDebt: number;
  openingDate: Date;
  note?: string;
}

export const debtOpeningExcelSchema: ExcelSchema<DebtOpeningImportRow> = {
  name: "Công nợ đầu kỳ",
  fileName: "Cong-no-dau-ky",
  description:
    "Nhập công nợ đầu kỳ cho khách hàng / nhà cung cấp. Dấu dương = công nợ phải thu (KH nợ) hoặc phải trả (mình nợ NCC); số âm = ngược lại (tạm ứng). Chỉ dùng 1 lần khi onboard.",
  columns: [
    {
      key: "partyType",
      header: "Loại đối tác",
      type: "enum",
      required: true,
      enumValues: ["customer", "supplier"] as const,
      enumLabels: {
        customer: "Khách hàng",
        supplier: "Nhà cung cấp",
      },
      example: "customer",
      width: 14,
    },
    {
      key: "partyCode",
      header: "Mã đối tác",
      type: "string",
      required: true,
      maxLength: 50,
      example: "KH0001",
      description: "Mã KH hoặc Mã NCC (phải đã tồn tại)",
      width: 14,
    },
    {
      key: "partyName",
      header: "Tên đối tác",
      type: "string",
      maxLength: 200,
      description:
        "Tên đối tác — chỉ để đọc dễ, không ghi vào DB (lookup qua Mã)",
      width: 28,
    },
    {
      key: "openingDebt",
      header: "Công nợ đầu kỳ",
      type: "number",
      required: true,
      example: 5000000,
      description:
        "Số tiền công nợ tại ngày khởi tạo. Dương = KH nợ / mình nợ NCC. Âm = KH đã đặt cọc / NCC ứng trước.",
      width: 18,
    },
    {
      key: "openingDate",
      header: "Ngày chốt số",
      type: "date",
      required: true,
      example: "2026-01-01",
      description: "Ngày bắt đầu ghi nhận công nợ",
      width: 16,
    },
    {
      key: "note",
      header: "Ghi chú",
      type: "string",
      maxLength: 500,
      width: 40,
    },
  ],
  validateRow: (row, _index, allRows) => {
    // Check không trùng partyCode trong cùng file (1 đối tác 1 opening)
    const dup = allRows.filter(
      (r) => r.partyCode === row.partyCode && r.partyType === row.partyType
    );
    if (dup.length > 1) {
      return `Mã "${row.partyCode}" (${row.partyType}) bị lặp — mỗi đối tác chỉ có 1 dòng công nợ đầu kỳ`;
    }
    return null;
  },
};
