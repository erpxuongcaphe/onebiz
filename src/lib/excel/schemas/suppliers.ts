/**
 * Excel schema: Nhà cung cấp (suppliers)
 */

import type { ExcelSchema } from "../types";

export interface SupplierImportRow {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  /** Địa chỉ đầy đủ (legacy). */
  address?: string;
  // Day 17/05 + 18/05/2026: structured address
  houseNumber?: string;
  street?: string;
  quarter?: string;
  ward?: string;
  province?: string;
  country?: string;
  taxCode?: string;
  note?: string;
  isActive?: boolean;
}

const PHONE_VN = /^(\+?84|0)(\d{9,10})$/;
// Day 18/05/2026 (CEO): bỏ regex chặn MST — cho phép nhập tự do (vd: NCC
// nước ngoài, MST tạm, hoặc format không chuẩn).

export const supplierExcelSchema: ExcelSchema<SupplierImportRow> = {
  name: "Nhà cung cấp",
  fileName: "Nha-cung-cap",
  description:
    "Danh sách nhà cung cấp. Mã NCC phải duy nhất. Mã số thuế (nếu có) phải đúng format 10 số hoặc 10-3.",
  columns: [
    {
      key: "code",
      header: "Mã NCC",
      type: "string",
      required: true,
      unique: true,
      maxLength: 50,
      example: "NCC001",
      width: 14,
    },
    {
      key: "name",
      header: "Tên NCC",
      type: "string",
      required: true,
      maxLength: 200,
      example: "Công ty TNHH Cà phê Việt",
      width: 32,
    },
    {
      key: "phone",
      header: "Số điện thoại",
      type: "string",
      maxLength: 20,
      pattern: PHONE_VN,
      patternMessage:
        "Số điện thoại phải là 10-11 chữ số, bắt đầu 0 hoặc +84",
      example: "0281234567",
      width: 16,
    },
    {
      key: "email",
      header: "Email",
      type: "string",
      maxLength: 200,
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      patternMessage: "Email không đúng định dạng",
      width: 24,
    },
    {
      key: "address",
      header: "Địa chỉ (cũ — text)",
      type: "string",
      maxLength: 500,
      description:
        "Địa chỉ dạng text (legacy). Khuyến nghị nhập 5 trường structured bên dưới. Day 17/05/2026.",
      example: "456 Lê Lợi, Q1, TP.HCM",
      width: 36,
    },
    // Day 17/05 + 18/05/2026: 6 cột structured address
    {
      key: "houseNumber",
      header: "Số nhà",
      type: "string",
      maxLength: 50,
      example: "456",
      width: 12,
    },
    {
      key: "street",
      header: "Tên đường",
      type: "string",
      maxLength: 200,
      example: "Lê Lợi",
      width: 22,
    },
    {
      key: "quarter",
      header: "Khu phố / Thôn",
      type: "string",
      maxLength: 100,
      width: 18,
    },
    {
      key: "ward",
      header: "Phường / Xã",
      type: "string",
      maxLength: 100,
      example: "Phường Bến Nghé",
      width: 22,
    },
    {
      key: "province",
      header: "Tỉnh / Thành phố",
      type: "string",
      maxLength: 100,
      description:
        "1 trong 34 tỉnh/thành VN sau sáp nhập 2025.",
      example: "TP. Hồ Chí Minh",
      width: 22,
    },
    {
      key: "country",
      header: "Quốc gia",
      type: "string",
      maxLength: 100,
      example: "Việt Nam",
      width: 16,
    },
    {
      key: "taxCode",
      header: "Mã số thuế",
      type: "string",
      maxLength: 50,
      example: "0301234567",
      width: 16,
    },
    {
      key: "note",
      header: "Ghi chú",
      type: "string",
      maxLength: 500,
      description: "Ghi chú nội bộ, ví dụ người liên hệ, điều khoản thanh toán, tuyến giao hàng.",
      width: 36,
    },
    {
      key: "isActive",
      header: "Đang hoạt động",
      type: "boolean",
      example: true,
      width: 14,
    },
  ],
};
