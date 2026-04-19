/**
 * Excel schema: Nhà cung cấp (suppliers)
 */

import type { ExcelSchema } from "../types";

export interface SupplierImportRow {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxCode?: string;
  contactPerson?: string;
  isActive?: boolean;
}

const PHONE_VN = /^(\+?84|0)(\d{9,10})$/;
const TAX_CODE = /^\d{10}(-\d{3})?$/;

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
      header: "Địa chỉ",
      type: "string",
      maxLength: 500,
      example: "456 Lê Lợi, Q1, TP.HCM",
      width: 40,
    },
    {
      key: "taxCode",
      header: "Mã số thuế",
      type: "string",
      maxLength: 20,
      pattern: TAX_CODE,
      patternMessage: "Mã số thuế phải là 10 chữ số (hoặc 10 số + '-' + 3 số)",
      example: "0301234567",
      width: 16,
    },
    {
      key: "contactPerson",
      header: "Người liên hệ",
      type: "string",
      maxLength: 100,
      width: 20,
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
