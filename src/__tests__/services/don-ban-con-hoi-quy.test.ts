import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tinhDoiChieuDatBan } from "@/lib/services/supabase/orders";
import schema from "../schema/db-schema.json";

/**
 * 17/08/2026 — PR5: HỒI QUY 12 ca CEO chốt cho luồng đơn bán con.
 * Mỗi ca một test, đánh số đúng thứ tự đề bài. Ca nào cơ chế nằm ở test
 * khác (component/wiring) thì ở đây khoá phần BẤT BIẾN nền của nó.
 */

const doc = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const SQL331 = doc("supabase/migrations/00331_child_sales_source_order.sql")
  .split("\n").filter((d) => !d.trim().startsWith("--")).join("\n");
const SQL332 = doc("supabase/migrations/00332_mark_order_processed.sql")
  .split("\n").filter((d) => !d.trim().startsWith("--")).join("\n");
const POS = doc("src/app/pos/page.tsx");
const SERVICE = doc("src/lib/services/supabase/orders.ts");
const COT_INVOICES = new Set((schema.bang as Record<string, string[]>).invoices);
const RPC = new Set(schema.rpc as string[]);

describe("Hồi quy đơn bán con — 12 ca CEO", () => {
  it("1. một đơn gốc tạo KHÔNG GIỚI HẠN đơn con — RPC không đếm, không chặn theo số lượng", () => {
    expect(SQL331).not.toMatch(/count\(\*\)[^;]*source_order_id/);
    expect(SQL331).not.toContain("fulfilled_by_id");
    // Khoá chia sẻ để nhiều lần tạo chạy song song.
    expect(SQL331).toMatch(/for share/);
  });

  it("2. mỗi đơn con có ID + client session RIÊNG — sinh mới từng lần gọi", () => {
    expect(SQL331).toContain("gen_random_uuid()");
    expect(SQL331).toMatch(/returning id into v_child_id/);
    expect(SQL331).toContain("public.next_code(v_tenant_id, 'pos_draft')");
  });

  it("3. lưu đơn con A không đổi B/C/đơn gốc — RPC tạo không update invoices; lưu nháp nhắm đúng 1 bản ghi", () => {
    expect(SQL331).not.toMatch(/update\s+public\.invoices/i);
    // POS lưu qua save_pos_draft_atomic_v3 (upsert theo session/id riêng từng đơn).
    expect(SERVICE).toContain('"save_pos_draft_atomic_v3"');
    expect(RPC.has("save_pos_draft_atomic_v3")).toBe(true);
  });

  it("4. xoá đơn con A không xoá B/C/đơn gốc — xoá mềm nhắm đúng một id", () => {
    const doan = SERVICE.slice(SERVICE.indexOf("export async function deleteDraftOrder"));
    const than = doan.slice(0, doan.indexOf("\nexport "));
    expect(than).toContain("invoiceId");
    expect(than).not.toContain("source_order_id");
  });

  it("5. thanh toán đơn con đi qua ĐÚNG RPC tiền/kho hiện có, không nhánh mới", () => {
    expect(SERVICE).toContain('"complete_draft_atomic_v5"');
    expect(RPC.has("complete_draft_atomic_v5")).toBe(true);
    // Luồng đơn con không sửa RPC thanh toán nào — 00331/00332 không định nghĩa lại.
    expect(SQL331).not.toContain("complete_draft");
    expect(SQL332).not.toContain("complete_draft");
  });

  it("6. đơn gốc KHÔNG bị tính doanh thu — không RPC nào của luồng này đổi status", () => {
    expect(SQL331).not.toMatch(/set[^;]*status\s*=/i);
    const capNhat332 = SQL332.slice(SQL332.indexOf("update public.invoices"));
    expect(capNhat332.slice(0, capNhat332.indexOf(";"))).not.toMatch(/status\s*=/);
  });

  it("7. hai tab lưu gần đồng thời không đè nhau — session riêng + guard revision còn nguyên", () => {
    // Mỗi lần bấm Xử lý đặt hàng = một session mới (ca 2) → hai tab khác session.
    // Cùng một đơn con mở hai nơi thì draft_revision (00292) chặn bản cũ.
    expect(COT_INVOICES.has("draft_revision")).toBe(true);
    expect(RPC.has("adopt_pos_draft_session_atomic_v2")).toBe(true);
  });

  it("8. tải lại trang mở đúng từng đơn con — POS nạp bằng childId, không nạp đơn gốc", () => {
    expect(POS).toContain("getDraftOrderById(child.childId)");
    const onPick = POS.slice(POS.indexOf("onPick={async (orderId)"));
    expect(onPick.slice(0, 3000)).not.toContain("getDraftOrderById(orderId)");
  });

  it("9. bán vượt số đặt là DỮ LIỆU, không phải lỗi — toán đối chiếu không ném", () => {
    const rows = tinhDoiChieuDatBan(
      [{ productId: "a", productName: "A", quantity: 2 }],
      [{ productId: "a", productName: "A", quantity: 9 }],
    );
    expect(rows[0].delta).toBe(7);
  });

  it("10. đóng đơn gốc là thao tác CHỦ ĐỘNG — chỉ 00332 (người bấm) ghi fulfilled_by_id", () => {
    expect(SQL331).not.toContain("fulfilled_by_id");
    expect(SQL332).toContain("set fulfilled_by_id = p_invoice_id");
    expect(SQL332).toContain("user_has_permission(v_actor, 'orders.create')");
  });

  it("11. mở lại đơn gốc không đụng đơn con — 00332 update đúng một dòng p_order_id", () => {
    const capNhat = SQL332.slice(SQL332.indexOf("update public.invoices"));
    const cau = capNhat.slice(0, capNhat.indexOf(";"));
    expect(cau).toContain("where id = p_order_id");
    expect(cau).not.toContain("source_order_id");
  });

  it("12. dữ liệu cũ không có source_order_id vẫn chạy như trước — cột nullable, lọc POS cũ nguyên vẹn", () => {
    expect(SQL331).toContain("add column if not exists source_order_id");
    expect(SQL331).not.toMatch(/alter table[^;]*source_order_id[^;]*not null/);
    // POS vẫn lọc danh sách chờ theo fulfilledById như 00188 — không đổi.
    expect(POS).toContain("!o.fulfilledById");
  });
});
