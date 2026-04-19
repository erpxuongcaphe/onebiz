/**
 * Excel schema: Sản phẩm (products)
 *
 * Import/Export cho cả NVL (nguyên vật liệu) và SKU (hàng bán).
 * User chỉ cần điền "Mã nhóm hàng" — backend sẽ resolve sang category_id
 * qua bảng categories.
 */

import type { ExcelSchema } from "../types";

/** Shape của 1 row Excel trước khi commit vào DB. */
export interface ProductImportRow {
  code: string;
  name: string;
  productType: "nvl" | "sku";
  channel?: "fnb" | "retail";
  categoryCode?: string; // resolve → category_id ở service
  unit: string;
  sellPrice: number;
  costPrice: number;
  stock?: number;
  minStock?: number;
  maxStock?: number;
  vatRate?: number;
  barcode?: string;
  groupCode?: string;
  purchaseUnit?: string;
  stockUnit?: string;
  sellUnit?: string;
  description?: string;
  allowSale?: boolean;
  isActive?: boolean;
}

export const productExcelSchema: ExcelSchema<ProductImportRow> = {
  name: "Sản phẩm",
  fileName: "San-pham",
  description:
    "Danh sách sản phẩm. Mã SP phải duy nhất. 'Loại' = nvl (nguyên vật liệu) hoặc sku (hàng bán). 'Kênh bán' chỉ áp dụng cho sku (fnb = bán tại quán; retail = bán lẻ/sỉ).",
  columns: [
    {
      key: "code",
      header: "Mã SP",
      type: "string",
      required: true,
      unique: true,
      minLength: 1,
      maxLength: 50,
      example: "CF001",
      description: "Mã sản phẩm duy nhất trong hệ thống",
      width: 16,
    },
    {
      key: "name",
      header: "Tên sản phẩm",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 200,
      example: "Cà phê đen đá",
      width: 30,
    },
    {
      key: "productType",
      header: "Loại",
      type: "enum",
      required: true,
      enumValues: ["nvl", "sku"] as const,
      enumLabels: {
        nvl: "Nguyên vật liệu",
        sku: "Hàng bán",
      },
      example: "sku",
      description: "nvl = nguyên vật liệu nội bộ; sku = hàng bán ra ngoài",
      width: 14,
    },
    {
      key: "channel",
      header: "Kênh bán",
      type: "enum",
      enumValues: ["fnb", "retail"] as const,
      enumLabels: {
        fnb: "FnB (tại quán)",
        retail: "Bán lẻ/sỉ",
      },
      example: "fnb",
      description:
        "Chỉ điền khi Loại = sku. Bỏ trống cho NVL. fnb = POS tại quán; retail = POS bán lẻ/sỉ",
      width: 14,
    },
    {
      key: "categoryCode",
      header: "Mã nhóm hàng",
      type: "string",
      maxLength: 50,
      example: "CF",
      description:
        "Mã nhóm hàng (Categories). Để trống nếu chưa phân nhóm. Nếu điền phải trùng mã đã tạo.",
      width: 14,
    },
    {
      key: "unit",
      header: "Đơn vị tính",
      type: "string",
      required: true,
      maxLength: 20,
      example: "Ly",
      width: 12,
    },
    {
      key: "sellPrice",
      header: "Giá bán",
      type: "number",
      required: true,
      min: 0,
      example: 35000,
      width: 14,
    },
    {
      key: "costPrice",
      header: "Giá vốn",
      type: "number",
      required: true,
      min: 0,
      example: 15000,
      width: 14,
    },
    {
      key: "stock",
      header: "Tồn kho ban đầu",
      type: "number",
      min: 0,
      example: 0,
      description: "Thường để 0 khi tạo mới. Tồn kho thực tế nhập qua phiếu nhập.",
      width: 16,
    },
    {
      key: "minStock",
      header: "Tồn tối thiểu",
      type: "number",
      min: 0,
      example: 5,
      description: "Cảnh báo hết hàng khi tồn ≤ giá trị này",
      width: 14,
    },
    {
      key: "maxStock",
      header: "Tồn tối đa",
      type: "number",
      min: 0,
      example: 1000,
      width: 12,
    },
    {
      key: "vatRate",
      header: "Thuế VAT (%)",
      type: "number",
      min: 0,
      max: 100,
      example: 8,
      description: "0, 5, 8, hoặc 10 theo luật thuế",
      width: 12,
    },
    {
      key: "barcode",
      header: "Mã vạch",
      type: "string",
      maxLength: 50,
      width: 16,
    },
    {
      key: "groupCode",
      header: "Mã group (tuỳ chọn)",
      type: "string",
      maxLength: 50,
      description: "Mã nhóm hàng tự do (VD 'Đồ uống nóng') để lọc/báo cáo",
      width: 16,
    },
    {
      key: "purchaseUnit",
      header: "ĐVT nhập",
      type: "string",
      maxLength: 20,
      description: "VD: Thùng, Bao (khác với ĐVT bán)",
      width: 12,
    },
    {
      key: "stockUnit",
      header: "ĐVT kho",
      type: "string",
      maxLength: 20,
      width: 12,
    },
    {
      key: "sellUnit",
      header: "ĐVT bán",
      type: "string",
      maxLength: 20,
      width: 12,
    },
    {
      key: "description",
      header: "Mô tả",
      type: "string",
      maxLength: 500,
      width: 40,
    },
    {
      key: "allowSale",
      header: "Cho phép bán",
      type: "boolean",
      example: true,
      description: "Có = cho phép bán; Không = ẩn khỏi POS",
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
  validateRow: (row) => {
    if (row.productType === "nvl" && row.channel) {
      return "NVL không được có Kênh bán — chỉ dùng cho hàng bán (sku)";
    }
    if (row.productType === "sku" && !row.channel) {
      return "Hàng bán (sku) phải có Kênh bán (fnb hoặc retail)";
    }
    if (
      row.minStock !== undefined &&
      row.maxStock !== undefined &&
      row.minStock > row.maxStock
    ) {
      return "Tồn tối thiểu không được lớn hơn tồn tối đa";
    }
    return null;
  },
};
