import { redirect } from "next/navigation";

// Sidebar v2 trỏ đến /he-thong/chi-nhanh nhưng trang thực tế hiện đang ở /cai-dat/chi-nhanh.
// Khi sprint chuyển nhà sang /he-thong/* hoàn tất, đổi sang implementation thật ở đây.
export default function HeThongChiNhanhRedirect() {
  redirect("/cai-dat/chi-nhanh");
}
