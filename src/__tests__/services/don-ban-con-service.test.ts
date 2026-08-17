import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tinhDoiChieuDatBan } from "@/lib/services/supabase/orders";

/**
 * 17/08/2026 — PR2 luồng đơn bán con: tầng service.
 *
 * Phần toán đối chiếu là hàm THUẦN, test thẳng số. Phần truy vấn khoá bằng
 * bất biến trên mã nguồn (đúng RPC, lọc đúng, thoái lui đúng khi máy chủ
 * chưa chạy 00331).
 */

const SERVICE = readFileSync("src/lib/services/supabase/orders.ts", "utf8");

function mh(productId: string, quantity: number, variantId?: string | null) {
  return {
    productId,
    variantId: variantId ?? null,
    productName: "SP " + productId,
    unit: "ly",
    quantity,
  };
}

describe("tinhDoiChieuDatBan — toán đối chiếu đặt/bán", () => {
  it("đặt 5, hai đơn con bán 2 + 4 = 6 → chênh +1 (vượt, KHÔNG phải lỗi)", () => {
    const rows = tinhDoiChieuDatBan(
      [mh("a", 5)],
      [mh("a", 2), mh("a", 4)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qtyOrdered: 5, qtySold: 6, delta: 1 });
  });

  it("bán thiếu: đặt 10, bán 3 → chênh -7", () => {
    const rows = tinhDoiChieuDatBan([mh("a", 10)], [mh("a", 3)]);
    expect(rows[0]).toMatchObject({ qtyOrdered: 10, qtySold: 3, delta: -7 });
  });

  it("mặt hàng thu ngân bán THÊM (không có trong đơn đặt) vẫn hiện, qtyOrdered=0", () => {
    const rows = tinhDoiChieuDatBan([mh("a", 2)], [mh("a", 2), mh("b", 1)]);
    const themB = rows.find((r) => r.productId === "b");
    expect(themB).toMatchObject({ qtyOrdered: 0, qtySold: 1, delta: 1 });
  });

  it("mặt hàng đặt nhưng CHƯA bán vẫn hiện, qtySold=0", () => {
    const rows = tinhDoiChieuDatBan([mh("a", 3)], []);
    expect(rows[0]).toMatchObject({ qtyOrdered: 3, qtySold: 0, delta: -3 });
  });

  it("hai quy cách của cùng sản phẩm là HAI dòng riêng", () => {
    const rows = tinhDoiChieuDatBan(
      [mh("a", 1, "size-m"), mh("a", 1, "size-l")],
      [mh("a", 5, "size-m")],
    );
    expect(rows).toHaveLength(2);
    const m = rows.find((r) => r.variantId === "size-m");
    const l = rows.find((r) => r.variantId === "size-l");
    expect(m).toMatchObject({ qtyOrdered: 1, qtySold: 5, delta: 4 });
    expect(l).toMatchObject({ qtyOrdered: 1, qtySold: 0, delta: -1 });
  });

  it("cùng mặt hàng lặp nhiều dòng trong một đơn thì cộng dồn", () => {
    const rows = tinhDoiChieuDatBan(
      [mh("a", 2), mh("a", 3)],
      [mh("a", 4)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qtyOrdered: 5, qtySold: 4, delta: -1 });
  });
});

describe("service đơn bán con — bất biến truy vấn", () => {
  it("createChildSaleFromOrder gọi đúng RPC 00331, máy chủ tự suy tenant/actor", () => {
    expect(SERVICE).toContain('"create_child_sale_from_order"');
    expect(SERVICE).toContain("p_order_id: orderId");
    expect(SERVICE).not.toContain("p_tenant_id: ");
  });

  it("máy chủ chưa chạy 00331: RPC thiếu → báo tiếng Việt rõ; cột thiếu → trả null", () => {
    expect(SERVICE).toContain("42883");
    expect(SERVICE).toContain("PGRST202");
    expect(SERVICE).toContain("migration 00331 chưa chạy");
    expect(SERVICE).toContain('MA_LOI_CHUA_CO_COT = "42703"');
    expect(SERVICE).toMatch(/MA_LOI_CHUA_CO_COT\) return null/);
  });

  it("listChildSales lọc đúng: theo source_order_id, bỏ đơn đã xoá mềm", () => {
    const doan = SERVICE.slice(SERVICE.indexOf("export async function listChildSales"));
    const than = doan.slice(0, doan.indexOf("export interface OrderReconRow"));
    expect(than).toContain('.eq("source_order_id", orderId)');
    expect(than).toContain('.is("deleted_at", null)');
    expect(than).toContain('.eq("tenant_id", tenantId)');
  });

  it("qtySold CHỈ cộng đơn con completed — nháp và đã huỷ không phải đã bán", () => {
    const doan = SERVICE.slice(
      SERVICE.indexOf("export async function getOrderReconciliation"),
    );
    expect(doan).toContain('c.status === "completed"');
  });

  it("cả khối service mới KHÔNG update/delete gì trên invoices — đơn gốc bất khả xâm phạm", () => {
    const doan = SERVICE.slice(SERVICE.indexOf("Đơn bán con từ đơn đặt hàng (00331)"));
    expect(doan).not.toMatch(/\.update\(/);
    expect(doan).not.toMatch(/\.delete\(/);
    expect(doan).not.toMatch(/\.upsert\(/);
  });
});
