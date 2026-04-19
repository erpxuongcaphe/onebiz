/**
 * Excel schema: Khách hàng (customers)
 */

import type { ExcelSchema } from "../types";

export interface CustomerImportRow {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  customerType: "individual" | "company";
  gender?: "male" | "female";
  groupCode?: string;
  isActive?: boolean;
}

/** Pattern SĐT Việt Nam: 10 chữ số, bắt đầu 0 / +84 / 84 */
const PHONE_VN = /^(\+?84|0)(\d{9,10})$/;

export const customerExcelSchema: ExcelSchema<CustomerImportRow> = {
  name: "Khách hàng",
  fileName: "Khach-hang",
  description:
    "Danh sách khách hàng. Mã KH phải duy nhất. Có thể để trống SĐT cho khách lẻ không đăng ký.",
  columns: [
    {
      key: "code",
      header: "Mã KH",
      type: "string",
      required: true,
      unique: true,
      maxLength: 50,
      example: "KH0001",
      description: "Mã khách hàng duy nhất trong hệ thống",
      width: 14,
    },
    {
      key: "name",
      header: "Tên khách",
      type: "string",
      required: true,
      maxLength: 200,
      example: "Nguyễn Văn A",
      width: 28,
    },
    {
      key: "phone",
      header: "Số điện thoại",
      type: "string",
      maxLength: 20,
      pattern: PHONE_VN,
      patternMessage:
        "Số điện thoại phải là 10-11 chữ số, bắt đầu 0 hoặc +84",
      example: "0901234567",
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
      example: "123 Nguyễn Huệ, Q1, TP.HCM",
      width: 40,
    },
    {
      key: "customerType",
      header: "Loại khách",
      type: "enum",
      required: true,
      enumValues: ["individual", "company"] as const,
      enumLabels: {
        individual: "Cá nhân",
        company: "Công ty",
      },
      example: "individual",
      width: 14,
    },
    {
      key: "gender",
      header: "Giới tính",
      type: "enum",
      enumValues: ["male", "female"] as const,
      enumLabels: {
        male: "Nam",
        female: "Nữ",
      },
      width: 12,
    },
    {
      key: "groupCode",
      header: "Mã nhóm KH",
      type: "string",
      maxLength: 50,
      description:
        "Mã nhóm khách hàng (VD: VIP, B2B). Phải tồn tại trong Nhóm KH. Bỏ trống nếu chưa phân nhóm.",
      width: 14,
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
