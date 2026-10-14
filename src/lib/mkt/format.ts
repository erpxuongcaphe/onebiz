import { formatCurrency, formatNumber as formatSharedNumber } from "@/lib/format";
// Shared en-US separators across Onebiz and MKT Hub.
// Trước đây money() nằm cục bộ trong trang Chiến dịch — mỗi màn tự format sẽ
// mỗi kiểu (bẫy #20 sổ bẫy 00196); nâng lên đây, mọi chỗ một chuẩn.

export function formatVnd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return formatCurrency(n) + "đ";
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return formatSharedNumber(n);
}
