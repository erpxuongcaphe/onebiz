import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  locToppingHopLe,
  TIEN_TO_SKU_TOPPING,
} from "@/lib/services/supabase/fnb-toppings";

/**
 * 08/08/2026 — Giai đoạn 2 topping (CEO chốt): nguồn topping của popup POS
 * FnB là SKU-TPP bán theo phần, KHÔNG còn NVL-TOP% giá nguyên túi/hộp.
 *
 * Điều kiện hợp lệ: tenant + SKU + fnb + active + BOM đang bật (+ giá > 0
 * tự vệ — 14 mã SKU-TPP khởi tạo giá 0đ, thiếu chặn này thì mã cấu hình dở
 * dang thành topping miễn phí).
 */

const SP = (id: string, name: string, sell_price: number | null) => ({
  id,
  name,
  sell_price,
});

describe("locToppingHopLe — lọc SKU topping bán theo phần", () => {
  it("giữ SKU có BOM đang bật VÀ giá > 0; map sell_price → price", () => {
    const kq = locToppingHopLe(
      [SP("a", "Trân Châu Trắng", 8000), SP("b", "Vải Ngâm Đường", 12000)],
      new Set(["a", "b"]),
    );
    expect(kq).toEqual([
      { id: "a", name: "Trân Châu Trắng", price: 8000 },
      { id: "b", name: "Vải Ngâm Đường", price: 12000 },
    ]);
  });

  it("KHÔNG có BOM đang bật → loại, dù có giá", () => {
    const kq = locToppingHopLe([SP("a", "Trân Châu Trắng", 8000)], new Set());
    expect(kq).toEqual([]);
  });

  it("giá 0đ hoặc null → loại, dù có BOM (mã cấu hình dở dang)", () => {
    const kq = locToppingHopLe(
      [SP("a", "Chưa đặt giá", 0), SP("b", "Giá null", null)],
      new Set(["a", "b"]),
    );
    expect(kq).toEqual([]);
  });

  it("13 mã chưa cấu hình + 1 mã đủ điều kiện → chỉ hiện đúng 1", () => {
    const chuaCauHinh = Array.from({ length: 13 }, (_, i) =>
      SP(`sku-${i}`, `SKU thô ${i}`, 0),
    );
    const kq = locToppingHopLe(
      [...chuaCauHinh, SP("ok", "Trân Châu Trắng", 8000)],
      new Set(["ok"]),
    );
    expect(kq).toEqual([{ id: "ok", name: "Trân Châu Trắng", price: 8000 }]);
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

  it("POS FnB không còn truy vấn NVL-TOP%", () => {
    expect(trang).not.toContain("NVL-TOP");
    expect(trang).toContain("getToppingPhanHopLe");
  });

  it("cache offline không còn truy vấn NVL-TOP%", () => {
    expect(cache).not.toContain("NVL-TOP");
    expect(cache).toContain("getToppingPhanHopLe");
  });

  it("nguồn duy nhất khai điều kiện CEO chốt: sku + fnb + active + BOM đang bật", () => {
    const nguon = boChuThich(
      readFileSync("src/lib/services/supabase/fnb-toppings.ts", "utf8"),
    );
    expect(nguon).toContain('eq("product_type", "sku")');
    expect(nguon).toContain('eq("channel", "fnb")');
    expect(nguon).toContain('eq("is_active", true)');
    expect(nguon).toContain('from("bom")');
    expect(TIEN_TO_SKU_TOPPING).toBe("SKU-TPP");
  });
});
