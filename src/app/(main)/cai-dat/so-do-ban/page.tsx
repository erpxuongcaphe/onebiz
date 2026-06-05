/**
 * Cũ: trang riêng cho manager per-branch.
 * Mới: redirect về /he-thong/so-do-ban — 1 trang phân quyền bên trong.
 *
 * Giữ route này để link cũ vẫn hoạt động.
 */

import { redirect } from "next/navigation";

export default function SoDoBanCaiDatRedirect() {
  redirect("/he-thong/so-do-ban");
}
