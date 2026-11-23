export function canVoidFnbWithoutOtp(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

export const FNB_VOID_APPROVAL_MESSAGE =
  "Mở Lịch sử bán trong POS FnB và chọn Xin duyệt hủy để dùng OTP của quản lý.";
