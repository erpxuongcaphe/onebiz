import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Guard Size 3 tầng — tầng máy chủ (00330) + tầng giao diện. */

const doc = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
const M = doc("supabase/migrations/00330_guard_size_variant_send_kitchen.sql");
const R = doc("supabase/migrations/00330_rollback_guard_size_variant_send_kitchen.sql");
const UI = doc("src/app/pos/fnb/components/fnb-item-dialog.tsx");
const POS = doc("src/app/pos/fnb/page.tsx");
const LENH = M.split("\n").filter((d) => !d.trimStart().startsWith("--")).join("\n");

describe("00330 — guard ở máy chủ", () => {
  it("bọc hàm cũ, không chép lại nghiệp vụ gửi bếp", () => {
    expect(LENH).toContain("rename to _fnb_send_to_kitchen_impl_00303");
    expect(LENH).toContain("return public._fnb_send_to_kitchen_impl_00303(");
    for (const dau of ["insert into public.kitchen_orders", "insert into public.kitchen_order_items",
                       "allocate_lots_fifo", "next_code"]) {
      expect(LENH, `không được chép lại ${dau}`).not.toContain(dau);
    }
  });

  it("giữ đúng chữ ký 12 tham số", () => {
    for (const p of ["p_branch_id uuid", "p_table_id uuid default null", "p_order_type text",
                     "p_idempotency_key text", "p_items jsonb", "p_delivery_platform text",
                     "p_delivery_fee numeric", "p_platform_commission_percent numeric",
                     "p_delivery_staff_id uuid", "p_delivery_distance_tier text",
                     "p_existing_order_id uuid"]) {
      expect(LENH).toContain(p);
    }
  });

  it("bắt buộc chọn cỡ khi món có quy cách đang bật", () => {
    expect(LENH).toContain("v_so_qc > 0 and v_vid is null");
    expect(LENH).toContain("vui lòng chọn cỡ trước khi gửi bếp");
  });

  it("quy cách phải đúng công ty, đúng món, đang bật", () => {
    expect(LENH).toMatch(/pv\.id = v_vid[\s\S]{0,120}pv\.product_id = v_pid[\s\S]{0,120}pv\.tenant_id = v_tenant[\s\S]{0,60}pv\.is_active/);
  });

  it("chặn giá 0 cho cả quy cách lẫn món không quy cách", () => {
    expect(LENH.match(/coalesce\(v_gia, 0\) <= 0/g)?.length).toBe(2);
    expect(LENH).toContain("chưa có giá bán");
  });

  it("cỡ phải có công thức riêng, không dùng công thức món cha", () => {
    expect(LENH).toContain("v_bom_code is null or v_bom_code = ''");
    expect(LENH).toContain("chưa có công thức riêng");
  });

  it("công thức phải đang bật và đúng chi nhánh (hoặc dùng chung)", () => {
    expect(LENH).toMatch(/b\.is_active[\s\S]{0,120}b\.branch_id = p_branch_id or b\.branch_id is null/);
  });

  it("kiểm hết rồi mới gọi nghiệp vụ — không ghi gì khi bị chặn", () => {
    const iLoop = LENH.indexOf("end loop;");
    const iGoi = LENH.indexOf("return public._fnb_send_to_kitchen_impl_00303(");
    expect(iLoop).toBeGreaterThan(-1);
    expect(iGoi).toBeGreaterThan(iLoop);
  });

  it("đọc được cả productId lẫn product_id, variantId lẫn variant_id", () => {
    for (const k of ["'productId'", "'product_id'", "'variantId'", "'variant_id'"]) {
      expect(LENH).toContain(k);
    }
  });

  it("thu hồi quyền gọi thẳng hàm nội bộ, wrapper chỉ cho authenticated", () => {
    expect(LENH).toMatch(/revoke all on function public\._fnb_send_to_kitchen_impl_00303[\s\S]{0,140}from public, anon, authenticated;/);
    expect(LENH).toMatch(/grant execute on function public\.fnb_send_to_kitchen_atomic_v2[\s\S]{0,140}to authenticated;/);
  });

  it("chạy lặp an toàn + không sửa dữ liệu + không đụng Retail", () => {
    expect(LENH).toContain("bo qua doi ten (chay lap an toan)");
    expect(LENH).not.toMatch(/\b(insert into public\.(invoices|stock_movements|product_variants|bom))\b/);
    expect(LENH).not.toMatch(/\bupdate public\.(products|product_variants|invoices)\b/);
    expect(LENH).not.toMatch(/void_completed_invoice_atomic_v2/);
  });

  it("rollback trả về hàm cũ, không sửa dữ liệu", () => {
    expect(R).toContain("rename to fnb_send_to_kitchen_atomic_v2");
    expect(R).not.toMatch(/\b(insert into|update public\.|delete from)\b/);
  });
});

describe("guard Size — tầng giao diện", () => {
  it("chọn cỡ mặc định theo cờ, không lấy phần tử đầu", () => {
    expect(UI).toContain("v.is_default && v.sell_price > 0");
    expect(UI).not.toContain("initVariant = variants?.[0]");
  });

  it("bắt buộc chọn cỡ khi món có quy cách", () => {
    expect(UI).toContain("const thieuQuyCach = coQuyCach && !selectedVariant;");
    expect(UI).toMatch(/canConfirm =[\s\S]{0,200}!thieuQuyCach/);
  });

  it("chặn giá ≤ 0", () => {
    expect(UI).toContain("unitPrice <= 0");
    expect(UI).toMatch(/canConfirm =[\s\S]{0,220}!giaKhongHopLe/);
  });

  it("nói rõ lý do bằng tiếng Việt thay vì nút chết câm", () => {
    expect(UI).toContain("Vui lòng chọn cỡ trước khi thêm món.");
    expect(UI).toContain("Món này chưa có giá bán. Báo quản lý nhập giá rồi bán lại.");
  });

  it("cờ mặc định được giữ suốt đường dữ liệu tới hộp thoại", () => {
    expect(POS.match(/is_default: v\.isDefault/g)?.length).toBe(4);
    expect(UI).toContain("is_default?: boolean");
  });
});
