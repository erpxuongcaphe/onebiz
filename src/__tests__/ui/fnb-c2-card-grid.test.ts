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
    // CARD_HEIGHT = toàn bộ bước hàng (gồm đệm đáy). Cộng GRID_GAP vào
    // estimateSize = đúp khoảng dọc 24px trong khi ngang 12px (CEO bắt 18/08).
    expect(GRID).toContain("estimateSize: () => CARD_HEIGHT,");
    expect(GRID).not.toContain("CARD_HEIGHT + GRID_GAP");
    expect(GRID).toContain("height: `${CARD_HEIGHT}px`");
    // Không được có height px hardcode nào khác trong style hàng/thẻ.
    const hardcoded = GRID.match(/height: `\d+px`/g) ?? [];
    expect(hardcoded).toEqual([]);
  });

  it("thẻ ăn chiều cao hàng qua h-full — không thể lệch với CARD_HEIGHT", () => {
    const cardClass = GRID.slice(GRID.indexOf("group relative flex flex-col"));
    expect(cardClass.slice(0, 200)).toContain("h-full");
  });

  it("hình học dọc: ảnh co (flex-1 min-h-0) đứng TRƯỚC khối chữ cố định — không cắt tên/giá", () => {
    // Đo thật preview 18/08 (thẻ 158px cao): ảnh 1→98, tên 102→130, giá
    // 130→149 ≤ 158. Bất biến làm nên hình học đó: thứ tự + lớp co/cố định.
    const iAnh = GRID.indexOf("relative min-h-0 flex-1 overflow-hidden p-2");
    const iChu = GRID.indexOf("flex-shrink-0 px-2.5");
    expect(iAnh).toBeGreaterThan(-1);
    expect(iChu).toBeGreaterThan(iAnh);
    // Cấm ảnh vuông/chiều cao cứng quay lại — nó từng đẩy tên ra ngoài.
    expect(GRID).not.toContain("aspect-square");
    // Ô hàng = CARD_HEIGHT có paddingBottom GRID_GAP → thẻ thật 158px.
    expect(GRID).toContain("paddingBottom: `${GRID_GAP}px`");
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

  it("mật độ: số cột đúng với CONTAINER THẬT đo trên preview (kể cả scrollbar)", async () => {
    const { getColsForWidth } = await import(
      "../../app/pos/fnb/components/fnb-product-grid"
    );
    // Số đo thật 18/08: desktop 1536 → contentRect 842 (scrollbar 10px ăn vào)
    expect(getColsForWidth(842)).toBe(5);
    expect(getColsForWidth(1226)).toBe(6); // desktop 1920
    expect(getColsForWidth(536)).toBe(3); // tablet ngang 1180
    expect(getColsForWidth(642)).toBe(4); // tablet dọc 820 (scrollbar 10)
    expect(getColsForWidth(635)).toBe(4); // tablet dọc 820 scrollbar Windows 17px
    expect(getColsForWidth(341)).toBe(2); // điện thoại 375
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
