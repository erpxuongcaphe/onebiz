import { redirect } from "next/navigation";

// Sidebar v2 đặt link Đối tác giao hàng dưới phân hệ "Đối tác" (/doi-tac/giao-hang),
// nhưng trang CRUD hiện đang nằm ở /don-hang/doi-tac-giao-hang.
// Tạm redirect để link không 404; sprint kế tiếp sẽ chuyển nhà file thực sự.
export default function DoiTacGiaoHangRedirect() {
  redirect("/don-hang/doi-tac-giao-hang");
}
