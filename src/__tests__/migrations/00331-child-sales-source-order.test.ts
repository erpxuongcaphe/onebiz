import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 17/08/2026 — PR1 luồng đơn bán con: khoá các BẤT BIẾN của bộ SQL 00331.
 *
 * Nguyên tắc CEO chốt:
 *   • Đơn gốc BẤT KHẢ XÂM PHẠM — RPC tạo đơn con không được update/delete
 *     bất kỳ dòng invoices nào.
 *   • KHÔNG giới hạn số đơn con, KHÔNG chặn theo fulfilled_by_id.
 *   • Nhiều tab tạo cùng lúc phải chạy song song (for share, không for update).
 *   • Đơn con auto_saved=false — nháp auto_saved bị cleanup dọn định kỳ
 *     (bài học mất đơn 00173).
 *
 * Đọc tệp thì CHUẨN HOÁ CRLF→LF trước — bài học test 00329 hỏng trên Windows.
 */

function doc(duongDan: string): string {
  return readFileSync(duongDan, "utf8").replace(/\r\n/g, "\n");
}

const MIGRATION = doc("supabase/migrations/00331_child_sales_source_order.sql");
const ROLLBACK = doc(
  "supabase/migrations/00331_rollback_child_sales_source_order.sql",
);

/** Bỏ dòng ghi chú `--` để không đếm nhầm chữ trong lời giải thích. */
const THAN = MIGRATION.split("\n")
  .filter((d) => !d.trim().startsWith("--"))
  .join("\n");

describe("00331 — cột quan hệ một-nhiều", () => {
  it("thêm cột additive (if not exists), nullable, FK về invoices", () => {
    expect(THAN).toMatch(
      /add column if not exists source_order_id uuid references public\.invoices\(id\)/,
    );
    // Không được NOT NULL — dữ liệu cũ phải chạy y như trước.
    // (chỉ soi câu ALTER; điều kiện chỉ mục "is not null" là chuyện khác)
    const cauAlter = THAN.slice(
      THAN.indexOf("alter table public.invoices"),
      THAN.indexOf("comment on column"),
    );
    expect(cauAlter).not.toMatch(/not null/);
  });

  it("chỉ mục một phía cho đối chiếu nhanh", () => {
    expect(THAN).toContain("create index if not exists idx_invoices_source_order_id");
    expect(THAN).toContain("where source_order_id is not null");
  });
});

describe("00331 — RPC tạo đơn con: đơn gốc bất khả xâm phạm", () => {
  it("KHÔNG update, KHÔNG delete bất kỳ dòng invoices nào", () => {
    expect(THAN).not.toMatch(/update\s+public\.invoices/i);
    expect(THAN).not.toMatch(/delete\s+from\s+public\.invoices/i);
  });

  it("KHÔNG đụng fulfilled_by_id — không đọc để chặn, không ghi", () => {
    expect(THAN).not.toContain("fulfilled_by_id");
  });

  it("khoá chia sẻ (for share) — nhiều tab tạo song song không xếp hàng", () => {
    expect(THAN).toMatch(/for share/);
    expect(THAN).not.toMatch(/for update/);
  });

  it("đơn con sinh mã dãy NH dùng chung với nháp POS + session mới", () => {
    expect(THAN).toContain("public.next_code(v_tenant_id, 'pos_draft')");
    expect(THAN).toContain("gen_random_uuid()");
  });

  it("auto_saved = false — không để cleanup dọn mất đơn con", () => {
    // Trong INSERT: ..., v_actor, v_session_id, false, (auto_saved) rồi parent id.
    expect(THAN).toMatch(/v_actor, v_session_id, false,/);
  });

  it("KHÔNG chép returned_qty — đơn bán mới chưa có trả hàng", () => {
    expect(THAN).not.toContain("returned_qty");
  });

  it("invoice_items KHÔNG có tenant_id — không được insert cột đó", () => {
    const doanItems = THAN.slice(THAN.indexOf("insert into public.invoice_items"));
    const danhSachCot = doanItems.slice(0, doanItems.indexOf(")"));
    expect(danhSachCot).not.toContain("tenant_id");
  });

  it("chỉ 4 lý do chặn: không thấy / sai source / đã xoá / đã huỷ — không chặn gì thêm", () => {
    const dauHam = THAN.indexOf("create or replace function");
    const cuoiHam = THAN.indexOf("end $$;", dauHam);
    const thanHam = THAN.slice(dauHam, cuoiHam);
    const soRaise = (thanHam.match(/raise exception/g) ?? []).length;
    // 2 chặn xác thực (chưa đăng nhập, chưa gắn công ty) + 4 chặn nghiệp vụ.
    expect(soRaise).toBe(6);
    // Tuyệt đối không giới hạn số đơn con.
    expect(THAN).not.toMatch(/count\(\*\)[^;]*source_order_id/);
  });

  it("quyền: thu hồi anon, cấp authenticated", () => {
    expect(THAN).toMatch(
      /revoke all on function public\.create_child_sale_from_order\(uuid\) from public, anon/,
    );
    expect(THAN).toMatch(
      /grant execute on function public\.create_child_sale_from_order\(uuid\) to authenticated/,
    );
  });

  it("hậu kiểm trong migration tự bắt thân hàm sửa/xoá invoices", () => {
    expect(MIGRATION).toContain("update\\s+public\\.invoices");
    expect(MIGRATION).toContain("00331 that bai");
  });
});

describe("00331 — rollback an toàn dữ liệu", () => {
  it("gỡ RPC, nhưng GIỮ cột khi đã có đơn con dùng", () => {
    expect(ROLLBACK).toContain(
      "drop function if exists public.create_child_sale_from_order(uuid)",
    );
    expect(ROLLBACK).toContain("where source_order_id is not null");
    expect(ROLLBACK).toMatch(/if v_dang_dung > 0 then/);
    // Chỉ drop cột trong nhánh CHƯA có dữ liệu.
    expect(ROLLBACK).toContain("drop column if exists source_order_id");
  });
});

describe("00331 — preflight/postflight chỉ đọc", () => {
  const PRE = doc("docs/PREFLIGHT-00331-DON-BAN-CON.sql");
  const POST = doc("docs/POSTFLIGHT-00331-DON-BAN-CON.sql");

  it("preflight: một câu SELECT, không ghi gì", () => {
    for (const f of [PRE, POST]) {
      const than = f
        .split("\n")
        .filter((d) => !d.trim().startsWith("--"))
        .join("\n")
        // Chuỗi văn bản ('update\s+...' trong câu kiểm thân hàm, nhãn tiếng
        // Việt...) là DỮ LIỆU, không phải câu lệnh — lột trước khi soi.
        .replace(/'[^']*'/g, "''");
      expect(than).not.toMatch(/\b(insert|update|delete|alter|create|drop|grant|revoke)\b/i);
      // Đúng MỘT câu lệnh (một dấu ; kết thúc).
      expect((than.match(/;/g) ?? []).length).toBe(1);
    }
  });

  it("postflight kiểm đủ: cột + chỉ mục + RPC + thân hàm + quyền anon", () => {
    expect(POST).toContain("source_order_id");
    expect(POST).toContain("idx_invoices_source_order_id");
    expect(POST).toContain("create_child_sale_from_order");
    expect(POST).toContain("anon");
    expect(POST).toContain("md5(pg_get_functiondef");
  });
});
