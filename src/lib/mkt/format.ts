// Định dạng số kiểu Việt DÙNG CHUNG cho MKT Hub.
// Trước đây money() nằm cục bộ trong trang Chiến dịch — mỗi màn tự format sẽ
// mỗi kiểu (bẫy #20 sổ bẫy 00196); nâng lên đây, mọi chỗ một chuẩn.

export function formatVnd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("vi-VN").format(n);
}
