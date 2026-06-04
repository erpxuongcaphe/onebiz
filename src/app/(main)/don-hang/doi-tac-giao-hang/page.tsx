import { redirect } from "next/navigation";

/**
 * CEO 03/06/2026 — Sprint 3 (audit menu P0): trang Đối tác giao hàng được hợp
 * nhất sang route canonical /doi-tac/giao-hang (sidebar V2 mới). Giữ redirect
 * cho link cũ + bookmark.
 */
export default function DoiTacGiaoHangLegacyRedirect() {
  redirect("/doi-tac/giao-hang");
}
