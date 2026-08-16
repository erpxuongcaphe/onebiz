import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * 00329 — huỷ hoá đơn F&B phải đối soát lại sổ lô.
 *
 * Bất biến sống còn: giữ NGUYÊN nghiệp vụ huỷ của bản 00165 (chỉ đổi tên thành
 * hàm nội bộ), chỉ thêm bước đối soát lô dựa trên movement THỰC TẾ. Không đụng
 * Retail, không đụng luồng trả hàng, không sửa dữ liệu.
 */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const M = doc("supabase/migrations/00329_fnb_void_reconcile_lots.sql");
const R = doc("supabase/migrations/00329_rollback_fnb_void_reconcile_lots.sql");
const P = doc("docs/POSTFLIGHT-00329-FIFO-HUY-FNB.sql");

const LENH = M.split("\n").filter((d) => !d.trimStart().startsWith("--")).join("\n");

describe("00329 — bọc hàm, không chép lại logic", () => {
  it("đổi tên bản cũ thành hàm nội bộ thay vì viết lại thân hàm", () => {
    expect(LENH).toContain("rename to _fnb_void_invoice_impl_00165");
    // Không được chép lại nghiệp vụ huỷ: các mốc đặc trưng của 00165 không xuất hiện
    for (const dau of ["increment_product_stock", "upsert_branch_stock",
                       "cash_transactions", "bom_consume", "modifier_topping"]) {
      expect(LENH, `không được chép lại đoạn ${dau}`).not.toContain(dau);
    }
  });

  it("dừng an toàn nếu bản trên máy chủ khác dấu vân tay đã kiểm", () => {
    expect(LENH).toContain("5c5d85efa6fbc4f3d91a064f96899234");
    expect(M).toContain("DUNG AN TOAN");
  });

  it("chạy lặp không hỏng — lần 2 thấy hàm nội bộ thì bỏ qua", () => {
    expect(LENH).toMatch(/v_impl_ton_tai[\s\S]{0,200}return;/);
  });

  it("lớp bọc giữ đúng chữ ký 8 tham số và kiểu trả về jsonb", () => {
    expect(LENH).toMatch(/create or replace function public\.fnb_void_invoice_atomic\(/);
    for (const p of ["p_invoice_id uuid", "p_kitchen_order_id uuid", "p_void_reason text",
                     "p_voided_by uuid", "p_tenant_id uuid", "p_branch_id uuid",
                     "p_shift_id uuid default null", "p_otp_id uuid default null"]) {
      expect(LENH).toContain(p);
    }
    expect(LENH).toContain("returns jsonb");
  });

  it("gọi hàm nội bộ trước, rồi mới đối soát", () => {
    const iImpl = LENH.indexOf("_fnb_void_invoice_impl_00165(\n");
    const iRec = LENH.indexOf("_reconcile_product_lots_to_branch_00284(");
    expect(iImpl).toBeGreaterThan(-1);
    expect(iRec).toBeGreaterThan(iImpl);
  });
});

describe("00329 — đối soát dựa trên movement thực tế", () => {
  it("lấy DISTINCT chi nhánh + sản phẩm từ movement invoice_void kiểu 'in'", () => {
    expect(LENH).toMatch(/select distinct sm\.branch_id, sm\.product_id/);
    expect(LENH).toContain("sm.reference_id = p_invoice_id");
    expect(LENH).toContain("sm.reference_type = 'invoice_void'");
    expect(LENH).toContain("sm.type = 'in'");
  });

  it("KHÔNG tính lại công thức (công thức có thể đã đổi sau khi bán)", () => {
    expect(LENH).not.toMatch(/\bbom\b/);
    expect(LENH).not.toContain("get_active_bom_for_branch");
    expect(LENH).not.toContain("consume_bom_for_sale");
  });

  it("truyền đúng nguồn đối soát để truy vết", () => {
    expect(LENH).toMatch(/'invoice_void', p_invoice_id, p_voided_by/);
  });

  it("giữ nguyên mọi khoá của kết quả cũ, chỉ thêm thông tin đối soát", () => {
    expect(LENH).toMatch(/coalesce\(v_ket_qua, '\{\}'::jsonb\)\s*\|\|/);
    expect(LENH).toContain("lots_reconciled_pairs");
  });
});

describe("00329 — quyền và phạm vi", () => {
  it("thu hồi quyền gọi thẳng hàm nội bộ", () => {
    expect(LENH).toMatch(/revoke all on function public\._fnb_void_invoice_impl_00165[\s\S]{0,120}from public, anon, authenticated;/);
  });

  it("lớp bọc chỉ cho người đã đăng nhập", () => {
    expect(LENH).toMatch(/revoke all on function public\.fnb_void_invoice_atomic[\s\S]{0,120}from public, anon;/);
    expect(LENH).toMatch(/grant execute on function public\.fnb_void_invoice_atomic[\s\S]{0,120}to authenticated;/);
  });

  it("không đụng Retail, không đụng trả hàng, không sửa dữ liệu", () => {
    expect(LENH).not.toMatch(/create or replace function public\.void_completed_invoice_atomic_v2/);
    expect(LENH).not.toMatch(/create or replace function public\.create_sales_return_atomic/);
    expect(LENH).not.toMatch(/\b(insert into public\.(invoices|stock_movements|product_lots|lot_allocations|cash_transactions))\b/);
    expect(LENH).not.toMatch(/\b(update public\.(invoices|branch_stock|products|product_lots))\b/);
    expect(LENH).not.toMatch(/\bdelete from\b/);
  });

  it("có hậu kiểm tự dừng khi bọc hỏng", () => {
    expect(M).toContain("lop boc chua goi du ham noi bo + ham doi soat");
    expect(M).toContain("ham noi bo van con % quyen goi truc tiep");
  });
});

describe("00329 — rollback và postflight", () => {
  it("rollback trả về đúng tên hàm cũ, không sửa dữ liệu", () => {
    expect(R).toContain("rename to fnb_void_invoice_atomic");
    expect(R).toMatch(/drop function if exists public\.fnb_void_invoice_atomic/);
    expect(R).not.toMatch(/\b(insert into|update public\.|delete from)\b/);
  });

  it("rollback chạy được cả khi 00329 chưa chạy", () => {
    expect(R).toContain("co le 00329 chua chay");
  });

  it("postflight chỉ đọc, đếm hoá đơn huỷ theo DISTINCT và tách kênh", () => {
    expect(P).not.toMatch(/\b(insert into|update |delete from|drop |alter function|grant |revoke )\b/i);
    expect(P).toContain("count(distinct sm.reference_id)");
    expect(P).toContain("i.source");
  });

  it("postflight kiểm đủ: lớp bọc, hàm nội bộ, quyền, Retail, trả hàng", () => {
    expect(P).toContain("LỚP BỌC");
    expect(P).toContain("_fnb_void_invoice_impl_00165");
    expect(P).toContain("QUYỀN GỌI");
    expect(P).toContain("void_completed_invoice_atomic_v2");
    expect(P).toContain("create_sales_return_atomic");
  });
});
