/**
 * Excel schema: Tồn kho ban đầu (initial stock import)
 *
 * Dùng khi khởi tạo chi nhánh mới — nhập tồn kho thực tế ở thời điểm chốt
 * vào hệ thống. Backend sẽ tạo 1 phiếu điều chỉnh kho (stock_adjustment)
 * để ghi nhận.
 */

import type { ExcelSchema } from "../types";

export interface InitialStockImportRow {
  productCode: string;
  productName?: string; // reference only
  branchCode: string;
  quantity: number;
  costPrice: number;
  note?: string;
  unit?: string;
  lotNumber?: string;
  expiryDate?: Date;
}

export const initialStockExcelSchema: ExcelSchema<InitialStockImportRow> = {
  name: "Tồn kho ban đầu",
  fileName: "Ton-kho-ban-dau",
  description:
    "Khởi tạo tồn hoặc bổ sung giá vốn ban đầu. Mỗi file một chi nhánh. Mã phải có sẵn; lượng và giá vốn theo đơn vị tồn Onebiz. Xem trước rồi xác nhận cả đợt. Mã đã phát sinh vận hành cần kiểm kê nếu muốn thay đổi lượng; không nhập lại số dư mỗi tháng.",
  columns: [
    {
      key: "productCode",
      header: "Mã SP",
      type: "string",
      required: true,
      maxLength: 50,
      example: "CF001",
      description: "Mã sản phẩm — phải đã tồn tại trong hệ thống",
      width: 14,
    },
    {
      key: "productName",
      header: "Tên SP",
      type: "string",
      maxLength: 200,
      description: "Tên SP — chỉ để đọc dễ, không ghi vào DB",
      width: 28,
    },
    {
      key: "branchCode",
      header: "Mã chi nhánh",
      type: "string",
      required: true,
      maxLength: 50,
      example: "CN01",
      description: "Mã chi nhánh — phải đã tồn tại trong Thiết lập Chi nhánh",
      width: 14,
    },
    {
      key: "quantity",
      header: "Số lượng",
      type: "number",
      required: true,
      min: 0,
      example: 100,
      width: 14,
    },
    {
      key: "costPrice",
      header: "Giá vốn",
      type: "number",
      required: true,
      min: 0,
      example: 15000,
      description: "Giá vốn trung bình ban đầu (VND/đvt)",
      width: 14,
    },
    {
      key: "note",
      header: "Ghi chú",
      type: "string",
      maxLength: 500,
      example: "Kiểm kê đầu kỳ 01/01/2026",
      width: 40,
    },
    {
      key: "unit", header: "ĐVT", type: "string", width: 12,
      description: "Đơn vị tồn Onebiz. Nếu có nhập phải khớp danh mục; tự quy đổi lượng và đơn giá trước khi nhập.",
    },
    {key:"lotNumber",header:"Số lô",type:"string",maxLength:100,width:18,description:"Tùy chọn cho tồn mới; mỗi mã một lô trong đợt nhập."},
    {key:"expiryDate",header:"Hạn sử dụng",type:"date",width:16,description:"Tùy chọn, DD/MM/YYYY. Để trống nếu chưa xác định, hệ thống không tự đoán."},
  ],
  validateRow: (row, _index, allRows) => {
    // 1 product × 1 branch chỉ có 1 dòng
    const dup = allRows.filter(
      (r) =>
        r.productCode === row.productCode && r.branchCode === row.branchCode
    );
    if (dup.length > 1) {
      return `SP "${row.productCode}" tại chi nhánh "${row.branchCode}" bị lặp — mỗi SP chỉ 1 dòng/chi nhánh`;
    }
    return null;
  },
};
