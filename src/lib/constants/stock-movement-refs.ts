/**
 * NGUỒN SỰ THẬT DUY NHẤT cho phân loại sổ kho (stock_movements).
 *
 * CEO 17/07/2026 — Thẻ kho Đợt 2 (plan docs/PLAN-THE-KHO.md): trước đây 3 nơi
 * tự giữ mapping riêng và lệch nhau (nhãn ở lich-su-kho, bucket XNT ở
 * xnt-report, typeName ở products.ts). File này gom về 1 chỗ; MỌI nơi phải
 * import từ đây, không tự khai lại.
 *
 * Commit 1 (gom): nội dung CHUYỂN NGUYÊN SI từ 3 file cũ — không đổi hành vi.
 * 13 reference_type CÓ THẬT trong DB (verify 17/07, đủ 2.231 dòng):
 *   bom_consume · initial_stock_import · purchase_order · initial_stock_reset
 *   · production_order · invoice_void · inventory_check · purchase_order_revert
 *   · production_reconcile · disposal_export · return_bom_restore · invoice
 *   · adjustment
 * Cột `type` chỉ có 'in'/'out' (adjust/transfer được constraint cho phép nhưng
 * không writer nào ghi).
 */

// ============================================================
// Nhãn "Loại chứng từ" (reference_type → tiếng Việt)
// — chuyển nguyên si từ lich-su-kho/page.tsx (referenceTypeLabels)
// ============================================================

export const REFERENCE_TYPE_LABELS: Record<string, string> = {
  invoice: "Hóa đơn",
  purchase_order: "Đơn nhập hàng",
  production_order: "Lệnh sản xuất",
  inventory_check: "Phiếu kiểm kho",
  disposal: "Phiếu xuất hủy",
  internal_export: "Xuất nội bộ",
  transfer: "Chuyển kho",
  return: "Trả hàng",
  pos: "POS Retail",
  // E (07/07): bổ sung nhãn còn thiếu — trước hiện mã thô (vd "bom_consume").
  bom_consume: "Tiêu hao công thức",
  modifier_topping: "Topping (tùy chọn)",
  invoice_void: "Hủy HĐ (hoàn kho)",
  sales_return: "Trả hàng bán",
  supplier_return: "Trả hàng nhập (NCC)",
  purchase_return: "Trả hàng nhập (NCC)",
  internal_sale: "Bán nội bộ",
  input_invoice: "Hóa đơn đầu vào",
  initial_stock_import: "Nhập tồn đầu kỳ",
  production_reconcile: "Đối soát sản xuất",
  production_complete: "Nhập kho sản xuất",
  production_consume: "Tiêu hao sản xuất",
  return_bom_restore: "Hồi NVL trả hàng",
  stock_adjustment: "Điều chỉnh tồn",
  purchase_entry: "Phiếu nhập hàng",
  goods_receipt: "Nhập hàng",
  // Đợt 2b (17/07): 4 nhãn THIẾU cho loại CÓ THẬT trong DB (151 dòng đang
  // hiện mã thô ở file xuất): initial_stock_reset 139 · purchase_order_revert 8
  // · disposal_export 3 · adjustment 1.
  initial_stock_reset: "Tồn đầu kỳ (ghi đè)",
  purchase_order_revert: "Hủy phiếu nhập (đảo kho)",
  disposal_export: "Phiếu xuất hủy",
  adjustment: "Điều chỉnh tồn",
};

// ============================================================
// Nhãn hướng giao dịch (stock_movements.type → tiếng Việt)
// — chuyển nguyên si từ products.ts (typeNameMap ×2 bản sao)
// ============================================================

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  in: "Nhập hàng",
  out: "Xuất hàng",
  adjust: "Kiểm kho",
  transfer: "Chuyển kho",
};

// ============================================================
// Bucket báo cáo Xuất-Nhập-Tồn (reference_type → cột NHẬP/XUẤT)
// — chuyển nguyên si từ xnt-report.ts (mapInBucket/mapOutBucket)
// ============================================================

export type XntInBucket =
  | "supplier"
  | "check"
  | "return"
  | "transfer"
  | "production"
  | "other";
export type XntOutBucket =
  | "sale"
  | "disposal"
  | "supplier_return"
  | "check"
  | "transfer"
  | "production"
  | "internal"
  | "other";

// Đợt 2b (CEO 17/07) — sửa phân loại theo quyết định CEO + bảng đối chiếu
// scripts/verify-xnt-mapping.mjs (chạy đủ 2.231 dòng thật, tổng NHẬP/XUẤT
// giữ nguyên tuyệt đối; chênh cột: out other −932.253 → sale +848.207
// (bom_consume) + supplier_return +84.046 (purchase_order_revert);
// in other −63,91 → return +62,91 (return_bom_restore) + check +1 (adjustment)).
// Bỏ 2 catch-all startsWith (purchase_/production) → liệt kê TƯỜNG MINH, vì
// catch-all bất đối xứng in/out từng làm cùng 1 loại chứng từ 2 số phận.

export function mapInBucket(referenceType: string | null): XntInBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  if (rt === "purchase_entry" || rt === "purchase_order" || rt === "goods_receipt")
    return "supplier";
  if (rt === "inventory_check" || rt === "stock_adjustment" || rt === "adjustment")
    return "check";
  // CEO 29/05/2026: hoàn kho do HỦY hóa đơn completed (movement bù type='in')
  // gom vào "hàng trả lại" để tổng Nhập cân với Xuất gốc (net = 0).
  // Đợt 2b: + return_bom_restore (hồi NVL khi khách trả hàng — cùng bản chất).
  if (rt === "sales_return" || rt === "invoice_void" || rt === "return_bom_restore")
    return "return";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (
    rt === "production_order" ||
    rt === "production_complete" ||
    rt === "production_reconcile" ||
    rt === "production_consume"
  )
    return "production";
  return "other"; // initial_stock_import... → cột "Nhập khác"
}

export function mapOutBucket(referenceType: string | null): XntOutBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  // CEO 17/07: bom_consume = BÁN — NVL bị trừ NGAY lúc khách thanh toán,
  // chứng từ gốc là HÓA ĐƠN (consume_bom_for_sale, reference_id = invoice_id).
  // modifier_topping cùng bản chất (topping tiêu hao theo hóa đơn FnB).
  if (
    rt === "invoice" ||
    rt === "sale" ||
    rt === "pos_sale" ||
    rt === "bom_consume" ||
    rt === "modifier_topping"
  )
    return "sale";
  if (rt === "disposal" || rt === "disposal_export") return "disposal";
  // Đợt 2b: + purchase_order_revert — hủy phiếu nhập đã nhận: hàng RA kho
  // theo hướng trả về NCC (đảo của nhập mua).
  if (
    rt === "supplier_return" ||
    rt === "purchase_return" ||
    rt === "purchase_order_revert"
  )
    return "supplier_return";
  if (rt === "inventory_check" || rt === "stock_adjustment" || rt === "adjustment")
    return "check";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (
    rt === "production_order" ||
    rt === "production_complete" ||
    rt === "production_reconcile" ||
    rt === "production_consume"
  )
    return "production";
  if (rt === "internal_export" || rt === "internal_sale" || rt === "input_invoice")
    return "internal";
  return "other"; // initial_stock_reset... → cột "Xuất khác"
}
