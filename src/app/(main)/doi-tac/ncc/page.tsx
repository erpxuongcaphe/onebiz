import { redirect } from "next/navigation";

// Sidebar v2 đặt link Nhà cung cấp dưới phân hệ "Đối tác" (/doi-tac/ncc),
// nhưng trang CRUD hiện đang nằm ở /hang-hoa/nha-cung-cap.
// Tạm redirect để link không 404; sprint kế tiếp sẽ chuyển nhà file thực sự.
export default function DoiTacNccRedirect() {
  redirect("/hang-hoa/nha-cung-cap");
}
