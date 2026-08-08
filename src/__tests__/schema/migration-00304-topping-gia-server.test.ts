import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 08/08/2026 — 00304: giá topping do MÁY CHỦ quyết (điểm 5 chỉ đạo CEO).
 * Migration kiểu PATCH TẠI CHỖ trên định nghĩa đang cài — test khoá các
 * bất biến để không ai sửa lệch hai file đi với nhau.
 */

const mig = readFileSync(
  "supabase/migrations/00304_fnb_topping_gia_server.sql",
  "utf8",
);
const rb = readFileSync(
  "supabase/migrations/00304_rollback_fnb_topping_gia_server.sql",
  "utf8",
);

/** Rút khối dollar-quoted $tag$...$tag$ đầu tiên trong một file. */
function khoi(src: string, tag: string): string {
  const m = src.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
  if (!m) throw new Error(`khong thay khoi $${tag}$`);
  return m[1];
}

describe("00304 — giá topping server-side (patch tại chỗ)", () => {
  it("nhắm đúng hàm impl đang cài + lọc prokind='f' (bài học 42809)", () => {
    for (const src of [mig, rb]) {
      expect(src).toContain("_fnb_complete_payment_impl_00230");
      expect(src).toContain("p.prokind = 'f'");
    }
  });

  it("idempotent bằng marker + fingerprint đếm ĐÚNG 2 lần, lệch là DỪNG", () => {
    expect(mig).toContain("GIA_TOPPING_SERVER_00304");
    expect(mig).toContain("<> 2");
    expect(mig).toContain("FINGERPRINT LECH");
    expect(rb).toContain("<> 2");
    expect(rb).toContain("FINGERPRINT LECH");
  });

  it("câu lệnh CŨ trong migration và rollback trùng từng byte", () => {
    expect(khoi(mig, "cu")).toBe(khoi(rb, "cu"));
    expect(khoi(mig, "cu")).toBe(
      "v_topping_price := coalesce((t->>'price')::numeric, 0);",
    );
  });

  it("khối MỚI trong migration và rollback trùng từng byte (rollback gỡ được)", () => {
    expect(khoi(mig, "moi")).toBe(khoi(rb, "moi"));
  });

  it("khối mới: chỉ SKU topping hợp lệ mới lấy giá máy chủ, còn lại giữ payload", () => {
    const moi = khoi(mig, "moi");
    expect(moi).toContain("p304.product_type = 'sku'");
    expect(moi).toContain("p304.channel = 'fnb'");
    expect(moi).toContain("p304.is_active");
    expect(moi).toContain("coalesce(p304.sell_price, 0) > 0");
    // Không tìm thấy SP (đơn cũ chỉ có productId) → giữ giá payload
    expect(moi).toContain("if v_topping_price is null then");
    expect(moi).toContain("nullif(t->>'product_id', '')::uuid");
  });

  it("KHÔNG đụng dữ liệu: không insert/update/delete bảng nghiệp vụ", () => {
    // Loại chú thích rồi soi THAO TÁC — migration chỉ đọc + execute DDL hàm.
    for (const src of [mig, rb]) {
      const sach = src
        .split("\n")
        .filter((d) => !d.trim().startsWith("--"))
        .join("\n")
        .toLowerCase();
      expect(sach).not.toMatch(/\binsert\s+into\b/);
      expect(sach).not.toMatch(/\bupdate\s+public\./);
      expect(sach).not.toMatch(/\bdelete\s+from\b/);
      expect(sach).not.toMatch(/\bdrop\s+(table|function)\b/);
    }
  });
});
