/**
 * Excel schema: Nhóm hàng (Categories) — CEO 22/05/2026
 *
 * MODEL: 1 row = 1 category. Hỗ trợ scope NVL + SKU (customer/supplier
 * dùng riêng bảng khác).
 *
 * MÃ NHÓM:
 *   - User tự đặt (3-20 ký tự, không cần prefix scope, hệ thống tự thêm
 *     prefix khi sinh mã SP).
 *   - Backend RPC `next_group_code` tự dedupe nếu user lỡ nhập prefix.
 *
 * UPSERT BY MÃ:
 *   - Nếu mã nhóm + scope đã tồn tại → cập nhật tên + channel.
 *   - Nếu chưa → tạo mới.
 *   - Tránh duplicate vô tình khi user upload nhiều lần.
 */

import type { ExcelSchema } from "../types";

export interface CategoryImportRow {
  /** "nvl" | "sku" — case insensitive, schema parse xuống lowercase */
  scope: "nvl" | "sku";
  /** Tên nhóm hiển thị (vd "Cà phê hạt", "Bao bì") */
  name: string;
  /** Mã nhóm (vd "CAFE", "BAO") — user tự đặt */
  code: string;
  /** Optional: "fnb" | "retail" cho SKU; NVL bỏ trống */
  channel?: "fnb" | "retail";
  /** Optional: số thứ tự sắp xếp (mặc định 0 = cuối list) */
  sortOrder?: number;
}

export const categoriesExcelSchema: ExcelSchema<CategoryImportRow> = {
  name: "Nhóm hàng",
  fileName: "Nhom-hang",
  description:
    "Danh mục nhóm hàng cho NVL và SKU. CỘT KÊNH BÁN bắt buộc cho SKU (fnb hoặc retail), NVL bỏ trống. Mã nhóm: 3-20 ký tự — vd CAFE, BAO, DCU. Upsert theo (scope + code): mã trùng → cập nhật tên/kênh.",
  columns: [
    {
      key: "scope",
      header: "Loại",
      type: "string",
      required: true,
      example: "nvl",
      description:
        "Loại nhóm: 'nvl' (Nguyên vật liệu) hoặc 'sku' (Hàng bán). Không phân biệt hoa thường.",
      width: 8,
      parse: (raw) => {
        const v = String(raw ?? "")
          .trim()
          .toLowerCase();
        if (v !== "nvl" && v !== "sku") {
          throw new Error(`Loại phải là 'nvl' hoặc 'sku', không phải '${raw}'`);
        }
        return v;
      },
    },
    {
      key: "name",
      header: "Tên nhóm",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 100,
      example: "Cà phê hạt",
      description: "Tên nhóm hàng hiển thị (vd 'Cà phê hạt', 'Bao bì').",
      width: 28,
    },
    {
      key: "code",
      header: "Mã nhóm",
      type: "string",
      required: true,
      minLength: 1,
      maxLength: 20,
      example: "CAFE",
      description:
        "Mã ngắn 3-10 ký tự viết hoa (vd CAFE, BAO, DCU). Không cần thêm NVL-/SKU- ở đầu — hệ thống tự dedupe khi sinh mã SP. Mã sẽ nhúng vào mã SP: vd nhóm 'CAFE' + scope 'nvl' → SP đầu tiên là NVL-CAFE-001.",
      width: 14,
      parse: (raw) =>
        String(raw ?? "")
          .trim()
          .toUpperCase(),
    },
    {
      key: "channel",
      header: "Kênh bán",
      type: "string",
      example: "fnb",
      description:
        "Kênh bán cho SKU: 'fnb' (pha chế tại quán) hoặc 'retail' (đóng gói bán lẻ). NVL bỏ trống. Không phân biệt hoa thường.",
      width: 10,
      parse: (raw) => {
        const v = String(raw ?? "")
          .trim()
          .toLowerCase();
        if (!v) return undefined;
        if (v !== "fnb" && v !== "retail") {
          throw new Error(`Kênh bán phải là 'fnb' hoặc 'retail', không phải '${raw}'`);
        }
        return v;
      },
    },
    {
      key: "sortOrder",
      header: "Thứ tự",
      type: "number",
      min: 0,
      example: 0,
      description:
        "Optional. Số thứ tự sắp xếp trong list (số nhỏ hiện trước). Mặc định 0.",
      width: 8,
    },
  ],
  validateRow(row) {
    // SKU bắt buộc channel
    if (row.scope === "sku" && !row.channel) {
      return "Nhóm SKU bắt buộc có 'Kênh bán' (fnb hoặc retail)";
    }
    // NVL không được có channel
    if (row.scope === "nvl" && row.channel) {
      return "Nhóm NVL không được có 'Kênh bán' — bỏ trống cột này";
    }
    return null;
  },
};
