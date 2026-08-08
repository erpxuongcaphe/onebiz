import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  locToppingHopLe,
  phamViCacheTopping,
  toppingsCacheConHieuLuc,
  TIEN_TO_SKU_TOPPING,
  type DongBom,
} from "@/lib/services/supabase/fnb-toppings";

/**
 * 08/08/2026 — Giai đoạn 2 topping (CEO chốt): nguồn topping của popup POS
 * FnB là SKU-TPP bán theo phần, KHÔNG còn NVL-TOP% giá nguyên túi/hộp.
 *
 * Hai điều kiện CEO bổ sung trước merge:
 *  1. BOM phải ÁP DỤNG ĐÚNG CHI NHÁNH đang chọn (nhân logic
 *     get_active_bom_for_branch) — không phải "có BOM ở đâu đó là hiện".
 *  2. Cache topping có PHIÊN BẢN — cache đời NVL-TOP vô hiệu ngay, offline
 *     không được hiện topping nguyên liệu cũ.
 */

const SP = (
  id: string,
  name: string,
  sell_price: number | null,
  bom_code: string | null = null,
) => ({ id, name, sell_price, bom_code });

const BOM = (
  product_id: string | null,
  branch_id: string | null,
  code: string | null = null,
): DongBom => ({ product_id, code, branch_id });

describe("locToppingHopLe — BOM áp dụng đúng chi nhánh (điều kiện CEO #1)", () => {
  const CN_A = "cn-a";
  const CN_B = "cn-b";

  it("BOM riêng chi nhánh A → hiện ở A, KHÔNG hiện ở B", () => {
    const sp = [SP("t1", "Trân Châu Trắng", 8000)];
    const bom = [BOM("t1", CN_A)];
    expect(locToppingHopLe(sp, bom, CN_A)).toHaveLength(1);
    expect(locToppingHopLe(sp, bom, CN_B)).toHaveLength(0);
  });

  it("BOM global (branch_id null) → áp dụng mọi chi nhánh", () => {
    const sp = [SP("t1", "Trân Châu Trắng", 8000)];
    const bom = [BOM("t1", null)];
    expect(locToppingHopLe(sp, bom, CN_A)).toHaveLength(1);
    expect(locToppingHopLe(sp, bom, CN_B)).toHaveLength(1);
  });

  it("chưa chọn chi nhánh → CHỈ BOM global áp dụng", () => {
    const sp = [SP("t1", "Global", 8000), SP("t2", "Riêng A", 9000)];
    const bom = [BOM("t1", null), BOM("t2", CN_A)];
    const kq = locToppingHopLe(sp, bom, null);
    expect(kq.map((t) => t.id)).toEqual(["t1"]);
  });

  it("SP có bom_code → tra theo CODE; mã mồ côi = KHÔNG công thức (y máy chủ)", () => {
    // get_active_bom_for_branch: có bom_code mà không tra ra bản nào thì trả
    // null luôn, KHÔNG rơi tiếp xuống nhánh product_id.
    const sp = [SP("t1", "Theo code", 8000, "BOM-TPP-1")];
    const dungCode = [BOM(null, CN_A, "BOM-TPP-1")];
    const saiCode = [BOM("t1", CN_A, "BOM-KHAC")]; // bom gắn product_id nhưng SP đã trỏ code
    expect(locToppingHopLe(sp, dungCode, CN_A)).toHaveLength(1);
    expect(locToppingHopLe(sp, saiCode, CN_A)).toHaveLength(0);
  });

  it("giá 0đ/null → loại dù BOM hợp lệ; map sell_price → price", () => {
    const sp = [
      SP("t1", "Chưa đặt giá", 0),
      SP("t2", "Giá null", null),
      SP("t3", "Đủ điều kiện", 8000),
    ];
    const bom = [BOM("t1", null), BOM("t2", null), BOM("t3", null)];
    expect(locToppingHopLe(sp, bom, "cn-a")).toEqual([
      { id: "t3", name: "Đủ điều kiện", price: 8000 },
    ]);
  });

  it("13 mã chưa cấu hình + 1 mã đủ điều kiện → chỉ hiện đúng 1", () => {
    const chuaCauHinh = Array.from({ length: 13 }, (_, i) =>
      SP(`sku-${i}`, `SKU thô ${i}`, 0),
    );
    const kq = locToppingHopLe(
      [...chuaCauHinh, SP("ok", "Trân Châu Trắng", 8000)],
      [BOM("ok", null)],
      "cn-a",
    );
    expect(kq).toEqual([{ id: "ok", name: "Trân Châu Trắng", price: 8000 }]);
  });
});

describe("phiên bản cache topping (điều kiện CEO #2)", () => {
  it("cache đời NVL-TOP không có dấu phạm vi → VÔ HIỆU", () => {
    expect(toppingsCacheConHieuLuc(undefined, "cn-a")).toBe(false);
    expect(toppingsCacheConHieuLuc(null, "cn-a")).toBe(false);
  });

  it("đúng phiên bản + đúng chi nhánh → còn hiệu lực", () => {
    expect(toppingsCacheConHieuLuc(phamViCacheTopping("cn-a"), "cn-a")).toBe(true);
  });

  it("cache của chi nhánh KHÁC → vô hiệu (BOM theo chi nhánh)", () => {
    expect(toppingsCacheConHieuLuc(phamViCacheTopping("cn-a"), "cn-b")).toBe(false);
  });

  it("đổi phiên bản nguồn trong tương lai → mọi cache cũ vô hiệu", () => {
    expect(toppingsCacheConHieuLuc("sku-tpp-v1:cn-a", "cn-a")).toBe(false);
  });
});

/**
 * Khoá nguồn: hai nơi tải topping (POS online + cache offline) phải cùng đi
 * qua fnb-toppings.ts, và KHÔNG còn chỗ nào bán topping theo NVL-TOP%.
 * Soi cả tệp nhưng loại chú thích trước — bài học cũ: chú thích giải thích
 * lỗi thường chứa đúng chuỗi đang tìm.
 */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
}

describe("Khoá nguồn topping — một cửa fnb-toppings.ts", () => {
  const trang = boChuThich(readFileSync("src/app/pos/fnb/page.tsx", "utf8"));
  const cache = boChuThich(readFileSync("src/lib/offline/cache-manager.ts", "utf8"));

  it("POS FnB không còn truy vấn NVL-TOP%; tải topping theo CHI NHÁNH", () => {
    expect(trang).not.toContain("NVL-TOP");
    expect(trang).toContain("getToppingPhanHopLe(tenantId, branchId)");
  });

  it("topping KHÔNG nấp sau cổng stale 30 phút của menu", () => {
    // Đổi chi nhánh trong cửa 30 phút: menu chưa stale nhưng topping đã
    // khác. Nếu topping nằm trong catalogPromise (gated needsRefresh) thì
    // đổi quán xong topping vẫn của quán cũ.
    const viTriGate = trang.indexOf("needsRefresh\n            ? Promise.all");
    const viTriTopping = trang.indexOf("getToppingPhanHopLe(tenantId, branchId)");
    expect(viTriTopping).toBeGreaterThan(0);
    const khoiGate = trang.slice(
      trang.indexOf("const catalogPromise"),
      trang.indexOf("const toppingsPromise"),
    );
    expect(khoiGate).not.toContain("getToppingPhanHopLe");
    expect(viTriGate === -1 || viTriTopping > viTriGate).toBe(true);
  });

  it("cache offline: không NVL-TOP; ghi topping kèm dấu phạm vi; đọc có kiểm dấu", () => {
    expect(cache).not.toContain("NVL-TOP");
    expect(cache).toContain("getToppingPhanHopLe(tenantId, branchId)");
    expect(cache).toContain('menuMetaKey(tenantId, "topping_scope")');
    expect(cache).toContain("toppingsCacheConHieuLuc");
  });

  it("nguồn duy nhất khai điều kiện CEO chốt: sku + fnb + active + bom + chi nhánh", () => {
    const nguon = boChuThich(
      readFileSync("src/lib/services/supabase/fnb-toppings.ts", "utf8"),
    );
    expect(nguon).toContain('eq("product_type", "sku")');
    expect(nguon).toContain('eq("channel", "fnb")');
    expect(nguon).toContain('eq("is_active", true)');
    expect(nguon).toContain('from("bom")');
    expect(nguon).toContain("branch_id.eq.");
    expect(nguon).toContain("branch_id.is.null");
    expect(TIEN_TO_SKU_TOPPING).toBe("SKU-TPP");
  });
});
