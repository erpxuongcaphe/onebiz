// Day 5 16/05/2026: Trang mục lục SOP — danh sách 4 vai trò.

import Link from "next/link";

const ROLES = [
  {
    href: "/sop/thu-ngan",
    title: "Thu ngân (Cashier)",
    desc: "Quy trình bán hàng tại quầy POS — mở ca, ghi nhận đơn, thu tiền, đóng ca.",
  },
  {
    href: "/sop/pha-che",
    title: "Pha chế (Barista)",
    desc: "Quy trình pha chế đồ uống theo phiếu bếp — quản lý nguyên liệu, vệ sinh.",
  },
  {
    href: "/sop/bep",
    title: "Bếp (Kitchen)",
    desc: "Quy trình tiếp nhận, chuẩn bị món ăn — xử lý màn hình KDS, báo cáo hết hàng.",
  },
  {
    href: "/sop/quan-ly",
    title: "Quản lý quán (Manager)",
    desc: "Quy trình giám sát — duyệt giảm giá / huỷ bill, kiểm kho, đóng ngày, báo cáo.",
  },
];

export default function SopIndexPage() {
  return (
    <div>
      <header className="header">
        <div>
          <h1>Sổ tay quy trình tác nghiệp</h1>
          <p className="role">Chọn vai trò để xem chi tiết → in (Ctrl+P) → lưu thành PDF.</p>
        </div>
        <div className="role">
          <b>OneBiz</b> • Ban hành ngày 16/05/2026
        </div>
      </header>

      <p>
        Sổ tay này dành cho nhân viên chuỗi cà phê OneBiz. Mỗi vai trò có quy trình
        riêng — đề nghị nhân viên đọc kỹ trước ca, in ra dán tại quầy/bếp để tham
        chiếu khi cần.
      </p>

      <ul className="no-print" style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {ROLES.map((r) => (
          <li
            key={r.href}
            style={{
              border: "1px solid #ddd",
              borderRadius: 6,
              padding: "10px 14px",
              marginBottom: 8,
              background: "#fafafa",
            }}
          >
            <Link
              href={r.href}
              style={{ color: "#1e3a8a", fontWeight: 600, textDecoration: "none" }}
            >
              {r.title} →
            </Link>
            <p style={{ margin: "4px 0 0", color: "#555" }}>{r.desc}</p>
          </li>
        ))}
      </ul>

      <div className="footer">
        Mọi thắc mắc, đề nghị liên hệ quản lý ca trực hoặc nhắn nhóm Zalo nội bộ
        &quot;OneBiz — Vận hành&quot;.
      </div>
    </div>
  );
}
