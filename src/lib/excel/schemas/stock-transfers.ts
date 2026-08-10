import type { ExcelSchema } from "../types";
import type { StockTransferExportRow } from "@/lib/services/supabase/transfers";

/** Schema chi dung de xuat danh sach; khong dung de nhap phieu chuyen kho. */
export const stockTransferExcelSchema: ExcelSchema<StockTransferExportRow> = {
  name: "Chuyển kho",
  fileName: "Danh-sach-chuyen-kho",
  description:
    "Danh sách phiếu chuyển kho và từng dòng sản phẩm theo bộ lọc đang xem.",
  columns: [
    { key: "code", header: "Mã phiếu", type: "string", width: 16 },
    { key: "status", header: "Trạng thái", type: "string", width: 16 },
    { key: "fromBranchCode", header: "Mã kho xuất", type: "string", width: 15 },
    { key: "fromBranchName", header: "Kho xuất", type: "string", width: 26 },
    { key: "toBranchCode", header: "Mã kho nhận", type: "string", width: 15 },
    { key: "toBranchName", header: "Kho nhận", type: "string", width: 26 },
    { key: "productCode", header: "Mã sản phẩm", type: "string", width: 18 },
    { key: "productName", header: "Tên sản phẩm", type: "string", width: 32 },
    { key: "unit", header: "Đơn vị", type: "string", width: 12 },
    { key: "quantity", header: "Số lượng", type: "number", width: 14 },
    { key: "note", header: "Ghi chú", type: "string", width: 30 },
    { key: "createdByName", header: "Người tạo", type: "string", width: 22 },
    { key: "createdAt", header: "Ngày tạo", type: "string", width: 20 },
    { key: "completedAt", header: "Ngày hoàn thành", type: "string", width: 20 },
  ],
};
