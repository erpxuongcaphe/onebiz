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

export function mapInBucket(referenceType: string | null): XntInBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  if (
    rt === "purchase_entry" ||
    rt === "purchase_order" ||
    rt === "goods_receipt" ||
    rt.startsWith("purchase_")
  )
    return "supplier";
  if (rt === "inventory_check" || rt === "stock_adjustment") return "check";
  // CEO 29/05/2026: hoàn kho do HỦY hóa đơn completed (movement bù type='in').
  // Gom vào "hàng trả lại" để tổng Nhập cân với Xuất gốc (net = 0), tránh
  // lệch tồn đầu kỳ. Xem RPC void_completed_invoice_atomic (migration 00117).
  if (rt === "sales_return" || rt === "invoice_void") return "return";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (rt.startsWith("production")) return "production"; // production_order/complete/reconcile
  return "other";
}

export function mapOutBucket(referenceType: string | null): XntOutBucket {
  if (!referenceType) return "other";
  const rt = referenceType.toLowerCase();
  if (rt === "invoice" || rt === "sale" || rt === "pos_sale") return "sale";
  if (rt === "disposal" || rt === "disposal_export") return "disposal";
  if (rt === "supplier_return" || rt === "purchase_return")
    return "supplier_return";
  if (rt === "inventory_check" || rt === "stock_adjustment") return "check";
  if (rt === "transfer" || rt === "stock_transfer") return "transfer";
  if (rt.startsWith("production")) return "production"; // production_consume/order/reconcile
  if (rt === "internal_export" || rt === "internal_sale" || rt === "input_invoice")
    return "internal";
  return "other";
}
