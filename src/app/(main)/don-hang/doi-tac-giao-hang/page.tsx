import { redirect } from "next/navigation";

/**
 * Địa chỉ CŨ của trang Đối tác giao hàng — giữ lại để bookmark và lịch sử
 * trình duyệt không chết. Trang thật nằm ở /doi-tac/giao-hang (khớp menu).
 *
 * ⚠️ 04/08/2026 — từ 04/06 tới nay file này redirect sang /doi-tac/giao-hang,
 * mà file bên đó lại redirect ngược về đây ⇒ vòng lặp vô hạn, menu "Đối tác
 * giao hàng" chết hẳn suốt 2 tháng. Chuyển hướng phải MỘT CHIỀU: chỉ file
 * này trỏ đi, bên kia là trang thật.
 */
export default function DoiTacGiaoHangLegacyRedirect() {
  redirect("/doi-tac/giao-hang");
}
