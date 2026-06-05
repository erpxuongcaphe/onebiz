/**
 * Payment method labels — single source of truth.
 *
 * Lý do tạo:
 *   Audit 05/06/2026 phát hiện 6 file định nghĩa METHOD_LABEL khác nhau:
 *   - shift-dialog.tsx (FnB): cash/transfer/card/wallet
 *   - fnb-order-history-dialog.tsx: cash/transfer/card/mixed
 *   - payment-history-tab.tsx: cash/transfer/card/ewallet
 *   - pending-shift-alert.tsx: inline ternary
 *   - print-shift-report.ts: KHÔNG dấu (Tien mat) cho máy in nhiệt
 *   - pos-checkout.ts: lowercase ("tiền mặt") cho format câu
 *
 * Hiện thực:
 *   - UI label (có dấu Tiếng Việt): formatPaymentMethod()
 *   - Print label (không dấu): formatPaymentMethodForPrint()
 *   - Hỗ trợ cả `wallet` và `ewallet` (DB cũ dùng cả 2)
 *
 * KHÔNG bao gồm lowercase variant — caller tự .toLowerCase() khi cần.
 */

/** Labels có dấu tiếng Việt cho UI */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  wallet: "Ví điện tử",
  ewallet: "Ví điện tử",
  mixed: "Hỗn hợp",
  other: "Khác",
};

/** Labels không dấu cho máy in nhiệt thường không hỗ trợ Unicode */
export const PAYMENT_METHOD_LABELS_PRINT: Record<string, string> = {
  cash: "Tien mat",
  transfer: "Chuyen khoan",
  card: "The",
  wallet: "Vi dien tu",
  ewallet: "Vi dien tu",
  mixed: "Hon hop",
  other: "Khac",
};

/**
 * Format payment method cho UI.
 * Fallback: trả lại nguyên text nếu key không match (vd "stripe", "momo").
 */
export function formatPaymentMethod(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

/**
 * Format payment method cho máy in nhiệt (không dấu).
 */
export function formatPaymentMethodForPrint(
  method: string | null | undefined,
): string {
  if (!method) return "-";
  return PAYMENT_METHOD_LABELS_PRINT[method] ?? method;
}
