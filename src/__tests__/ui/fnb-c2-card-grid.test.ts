import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * C2 (CEO 18/08/2026) — thẻ món + cột danh mục POS FnB.
 *
 * Bất biến khoá:
 *   • CARD_HEIGHT là NGUỒN DUY NHẤT cho chiều cao hàng của bộ cuộn ảo —
 *     đổi chiều cao thẻ mà không đổi hằng số này thì món chồng lên nhau.
 *     Thẻ ăn chiều cao hàng qua h-full nên hai thứ không thể lệch.
 *   • Thứ tự thẻ: ảnh → tên (2 dòng) → GIÁ dòng riêng (không đè ảnh, không
 *     bị che) — CEO chốt "giá luôn thấy".
 *   • Danh mục: tên tối đa 2 dòng (không truncate), chạm ≥44px, vạch chỉ báo.
 *
 * Đọc tệp chuẩn hoá CRLF→LF (bài học test 00329 đỏ oan trên Windows).
 */

const doc = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");

const GRID = doc("src/app/pos/fnb/components/fnb-product-grid.tsx");
const SIDEBAR = doc("src/app/pos/fnb/components/fnb-category-sidebar.tsx");

describe("C2 — bộ cuộn ảo và chiều cao thẻ đổi CÙNG NHAU", () => {
  it("CARD_HEIGHT = 170 và là hằng số duy nhất", () => {
    expect(GRID).toContain("const CARD_HEIGHT = 170;");
    expect((GRID.match(/const CARD_HEIGHT = /g) ?? []).length).toBe(1);
  });

  it("virtualizer + chiều cao hàng đều đọc từ CARD_HEIGHT, không hardcode", () => {
    expect(GRID).toContain("estimateSize: () => CARD_HEIGHT + GRID_GAP");
    expect(GRID).toContain("height: `${CARD_HEIGHT}px`");
    // Không được có height px hardcode nào khác trong style hàng/thẻ.
    const hardcoded = GRID.match(/height: `\d+px`/g) ?? [];
    expect(hardcoded).toEqual([]);
  });

  it("thẻ ăn chiều cao hàng qua h-full — không thể lệch với CARD_HEIGHT", () => {
    const cardClass = GRID.slice(GRID.indexOf("group relative flex flex-col"));
    expect(cardClass.slice(0, 200)).toContain("h-full");
  });
});

describe("C2 — thẻ món: ảnh → tên 2 dòng → giá dòng riêng", () => {
  it("giá KHÔNG còn là badge đè trên ảnh", () => {
    expect(GRID).not.toMatch(/absolute[^"]*top-3 right-3[^"]*bg-primary/);
  });

  it("giá nằm trong khối chữ, tabular-nums, không xuống dòng", () => {
    const textBlock = GRID.slice(GRID.indexOf("flex-shrink-0 px-2.5"));
    expect(textBlock).toContain("formatCurrency(product.sell_price)");
    expect(textBlock).toContain("tabular-nums");
    expect(textBlock).toContain("whitespace-nowrap");
  });

  it("tên món tối đa 2 dòng + giữ chỗ cố định (thẻ không nhảy)", () => {
    expect(GRID).toContain("line-clamp-2");
    expect(GRID).toContain("min-h-[2.1em]");
  });

  it("mật độ: có bậc 6 cột và bậc 5 cột từ 850px container", () => {
    expect(GRID).toMatch(/minWidth: 1100, cols: 6/);
    expect(GRID).toMatch(/minWidth: 850, cols: 5/);
  });
});

describe("C2 — cột danh mục", () => {
  it("tên nhóm 2 dòng, không truncate", () => {
    const btn = SIDEBAR.slice(SIDEBAR.indexOf("function CategoryButton"));
    expect(btn).toContain("line-clamp-2");
    expect(btn).not.toContain("truncate");
  });

  it("vùng chạm ≥44px (min-h-11)", () => {
    expect(SIDEBAR).toContain("min-h-11");
  });

  it("nhóm đang chọn có vạch chỉ báo", () => {
    expect(SIDEBAR).toMatch(/active &&[\s\S]{0,200}w-\[3px\][\s\S]{0,80}bg-primary/);
  });
});
