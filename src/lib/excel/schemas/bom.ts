/**
 * Excel schema: Công thức sản xuất (BOM) — CEO 20/05/2026
 *
 * MODEL: 1 sheet phẳng, denormalized.
 *   - 1 row = 1 NVL của 1 BOM
 *   - Master BOM info (Mã BOM + Tên BOM) repeat ở mỗi row của cùng 1 BOM
 *   - Service parse: group by bomCode → row đầu cung cấp master info,
 *     mọi row là items
 *
 * STANDALONE BOM:
 *   - Không có cột "Mã SKU" — BOM tồn tại độc lập
 *   - SKU gắn BOM sau qua products.bom_code (Excel SP cột "Mã BOM" hoặc form)
 *
 * MÃ BOM:
 *   - User tự đặt theo format docs: BOM-{NHÓM}-{NNN} (vd BOM-CFS-001)
 *   - Optional — nếu trống service auto-gen qua nextGroupCode (CHỜ Phase tiếp)
 *   - Unique per (tenant, code, branch_id) — enforced bởi migration 00106
 */

import type { ExcelSchema } from "../types";

export interface BOMImportRow {
  bomCode: string;        // Mã BOM (auto-gen nếu trống, không yet implemented Phase này — bắt buộc)
  bomName: string;        // Tên BOM (vd "Bạc xỉu chuẩn")
  branchCode?: string;    // Mã chi nhánh — trống = global BOM
  materialCode: string;   // Mã NVL (NVL-CPH-001)
  quantity: number;       // Số lượng NVL
  unit: string;           // ĐVT (g, ml, lon, cái)
  yieldQty?: number;      // Năng suất BOM (default 1)
  yieldUnit?: string;     // ĐVT năng suất (default "cái")
  note?: string;          // Ghi chú riêng cho row item
}

export const bomExcelSchema: ExcelSchema<BOMImportRow> = {
  name: "Công thức sản xuất (BOM)",
  fileName: "Cong-thuc-BOM",
  description:
    "Danh sách công thức sản xuất (BOM). MỖI ROW = 1 NVL của 1 BOM. Master info (Mã BOM + Tên BOM) lặp lại ở mỗi row cùng 1 BOM (Excel auto-fill drag xuống). BOM tồn tại ĐỘC LẬP — không cần Mã SKU ở đây. Gắn BOM vào SKU sau qua trang Sản phẩm (cột 'Mã BOM' trong Excel SP hoặc form). Mã BOM format chuẩn: BOM-{NHÓM}-{NNN} (vd BOM-CFS-001).",
  columns: [
    {
      key: "bomCode",
      header: "Mã BOM",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 50,
      example: "BOM-CFS-001",
      description:
        "Mã BOM duy nhất trong hệ thống. Format chuẩn: BOM-{NHÓM}-{NNN}. Lặp lại ở các row cùng 1 BOM (vd 3 NVL → 3 row cùng Mã BOM 'BOM-CFS-001').",
      width: 18,
    },
    {
      key: "bomName",
      header: "Tên BOM",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 200,
      example: "Bạc xỉu chuẩn",
      description:
        "Tên công thức (vd 'Bạc xỉu chuẩn', 'Cà phê sữa đá phiên bản 2024'). Lặp lại ở các row cùng 1 BOM.",
      width: 28,
    },
    {
      key: "branchCode",
      header: "Mã chi nhánh",
      type: "string",
      maxLength: 50,
      example: "Q1",
      description:
        "Optional. Để TRỐNG = BOM global (áp dụng mọi chi nhánh). Điền mã chi nhánh khi muốn BOM CHỈ áp dụng riêng cho 1 quán/kho (vd Q1 dùng đường ít hơn Q2).",
      width: 14,
    },
    {
      key: "materialCode",
      header: "Mã NVL",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 50,
      example: "NVL-CPH-001",
      description:
        "Mã nguyên vật liệu trong công thức. Phải tồn tại trong hệ thống (tạo ở trang Hàng hoá trước).",
      width: 18,
    },
    {
      key: "quantity",
      header: "Số lượng",
      type: "number",
      required: true,
      min: 0,
      example: 18,
      description:
        "Số lượng NVL cần để tạo 1 đơn vị sản phẩm theo BOM (vd 1 ly Bạc xỉu = 18g cà phê).",
      width: 12,
    },
    {
      key: "unit",
      header: "ĐVT",
      type: "string",
      required: true,
      maxLength: 20,
      example: "g",
      description:
        "Đơn vị tính của NVL trong công thức (g, ml, kg, ml...). Có thể khác đơn vị tính chính của NVL — vd NVL lưu kho theo kg nhưng công thức cần g.",
      width: 10,
    },
    {
      key: "yieldQty",
      header: "Năng suất",
      type: "number",
      min: 0,
      example: 1,
      description:
        "Optional. Mặc định 1. Năng suất BOM = số đơn vị SKU sản xuất từ 1 batch (vd 1 batch xay cà phê = 10kg → yield_qty=10).",
      width: 12,
    },
    {
      key: "yieldUnit",
      header: "ĐVT năng suất",
      type: "string",
      maxLength: 20,
      example: "ly",
      description:
        "Optional. Mặc định 'cái'. Đơn vị của năng suất (ly, kg, cái).",
      width: 14,
    },
    {
      key: "note",
      header: "Ghi chú",
      type: "string",
      maxLength: 500,
      description:
        "Ghi chú riêng cho row item này (vd 'Cà phê rang Robusta loại 1').",
      width: 32,
    },
  ],
  validateRow(row) {
    // Validate quantity > 0
    if (row.quantity !== undefined && row.quantity <= 0) {
      return "Số lượng phải > 0";
    }
    return null;
  },
};
