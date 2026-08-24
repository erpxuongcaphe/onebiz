import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * C3 (CEO 18/08/2026) — trình bày giỏ hàng POS FnB.
 *
 * Bất biến khoá:
 *   • CartLineItem CHỈ RENDER giá trị có sẵn (unitPrice/quantity/lineTotal)
 *     — không được tự tính/làm tròn trong component trình bày.
 *   • Tên món tối đa 2 dòng; tuỳ chọn/topping/ghi chú ở dòng phụ riêng.
 *   • Số tiền tabular-nums + nowrap; ô số lượng min-w (chứa "5.17" — format.ts en-US).
 *   • Footer thu gọn ở màn thấp nhưng GIỮ tổng + nút hành động chính.
 *   • Nút −/+/sửa/xoá có aria-label; chạm 44px trên mobile (size-11).
 *
 * Đọc tệp chuẩn hoá CRLF→LF (bài học 00329).
 */

const doc = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const CART = doc("src/app/pos/fnb/components/fnb-cart.tsx");
const LINE = CART.slice(CART.indexOf("function CartLineItem"));

describe("C3 — dòng món chỉ render, không tự tính", () => {
  it("hiện đơn giá × số lượng và thành tiền từ giá trị có sẵn", () => {
    expect(LINE).toContain("formatCurrency(line.lineTotal)");
    expect(LINE).toContain("formatCurrency(line.unitPrice)");
    expect(LINE).toContain("formatNumber(line.quantity)");
  });

  it("KHÔNG có phép nhân/tính toán tiền trong component trình bày", () => {
    // Mọi phép * trong CartLineItem là cấm — tính tiền thuộc hook/RPC.
    expect(LINE).not.toMatch(/line\.unitPrice\s*\*/);
    expect(LINE).not.toMatch(/\*\s*line\.quantity/);
    expect(LINE).not.toContain("Math.round");
  });

  it("tên món tối đa 2 dòng, xuống dòng hợp lý", () => {
    expect(LINE).toMatch(/line-clamp-2 break-words/);
  });

  it("số tiền tabular-nums + nowrap (không cắt, không giật)", () => {
    const cotSo = LINE.slice(LINE.indexOf("shrink-0 text-right"), LINE.indexOf("Toppings"));
    expect((cotSo.match(/tabular-nums whitespace-nowrap/g) ?? []).length).toBe(2);
    // CEO 19/08: dòng "đơn giá × SL" tối thiểu 12px — cấm text-[11px] trong cột số.
    expect(cotSo).not.toContain("text-[11px]");
  });

  it("ô số lượng min-w thay w cứng — chứa 5,17 không tràn", () => {
    expect(LINE).toMatch(/min-w-9 px-1 text-center tabular-nums whitespace-nowrap/);
    expect(LINE).not.toMatch(/font-semibold w-7 text-center/);
  });

  it("nút −/+/sửa/xoá đủ aria-label + chạm 44px mobile", () => {
    for (const nhan of ["Giảm số lượng", "Tăng số lượng", "Sửa tuỳ chọn", "Xoá món"]) {
      expect(LINE).toContain(`aria-label="${nhan}"`);
    }
    expect((LINE.match(/size-11 md:size-9/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("C3 — footer màn thấp: THU GỌN có nút mở, KHÔNG ẩn cứng (CEO 18/08)", () => {
  it("nhóm hàng phụ chỉ ẩn KHI CHƯA MỞ (!moPhanPhu) — xoay ngang/bàn phím vẫn mở lại được", () => {
    const footer = CART.slice(CART.indexOf("Footer: totals + discount + actions"));
    // Ẩn phải là ĐIỀU KIỆN theo state, không phải class cứng.
    expect(footer).toContain('!moPhanPhu && "[@media(max-height:540px)]:hidden"');
    // Cấm ẩn cứng quay lại (chuỗi class liền không qua cn điều kiện), mọi ngưỡng.
    expect(footer).not.toMatch(/"space-y-3 \[@media\(max-height:\d+px\)\]:hidden"/);
    expect(footer).not.toMatch(/"flex gap-2 \[@media\(max-height:\d+px\)\]:hidden"/);
  });

  it("C3.1: HAI ngưỡng đúng vai — 540 thu gọn (5 chỗ), 620 CHỈ cuộn dự phòng", () => {
    // 4 class thu gọn cùng ngưỡng 540: p-2.5 + space-y-2 + toggle flex + 2× hidden.
    expect((CART.match(/max-height:540px/g) ?? []).length).toBe(5);
    // 620 còn lại DUY NHẤT ở cuộn dự phòng container (C1) — 541–620px hiện
    // đầy đủ thì nội dung dài hơn màn, phải cuộn tới được Bếp/Thanh toán.
    expect((CART.match(/max-height:620px/g) ?? []).length).toBe(1);
    expect(CART).toContain("[@media(max-height:620px)]:overflow-y-auto");
  });

  it("có nút thu gọn với aria-expanded + tóm tắt ưu đãi luôn hiện khi có", () => {
    expect(CART).toContain("aria-expanded={moPhanPhu}");
    expect(CART).toContain("Ưu đãi &amp; thêm");
    expect(CART).toMatch(/coUuDai =\s*\n?\s*orderDiscountAmount > 0 \|\| !!appliedCouponCode/);
    // CEO 19/08: nút thu gọn vùng chạm ≥44px (min-h-11).
    expect(CART).toMatch(/aria-expanded=\{moPhanPhu\}[\s\S]{0,220}min-h-11/);
  });

  it("tổng Khách cần trả nằm NGOÀI nhóm thu gọn + footer bó padding màn thấp", () => {
    const footer = CART.slice(CART.indexOf("Footer: totals + discount + actions"));
    const dongNhom = footer.indexOf("</div>\n\n        {(() => {");
    const tong = footer.indexOf("Khách cần trả");
    expect(dongNhom).toBeGreaterThan(-1);
    expect(tong).toBeGreaterThan(dongNhom);
    expect(CART).toContain("[@media(max-height:540px)]:p-2.5");
  });

  it("nút Bếp/Thanh toán KHÔNG bị ẩn theo media màn thấp", () => {
    const hanhDong = CART.slice(CART.indexOf("Primary actions row"));
    expect(hanhDong.slice(0, 300)).not.toContain("max-height");
  });
});

describe("C3 — thao tác thu ngân trên màn cảm ứng", () => {
  it("giữ vùng chạm 44px cho các điểm đổi loại đơn, phí giao, ưu đãi và hành động chính", () => {
    const zoneOrderType = CART.slice(
      CART.indexOf("Order type pill row"),
      CART.indexOf("Cart lines"),
    );
    const footerActions = CART.slice(CART.indexOf("Primary actions row"));

    expect(zoneOrderType).toContain("min-h-11 lg:min-h-7 lg:h-7");
    expect(zoneOrderType).toContain("min-h-11 lg:min-h-8 lg:h-8");
    expect(zoneOrderType).toContain("min-h-11 lg:min-h-8");
    expect(footerActions).toContain("h-14");
    expect(CART).toContain("function CouponRow");
    expect(CART).toContain("min-h-11 min-w-11 lg:min-h-7 lg:min-w-7 lg:h-7 lg:w-7");
    expect(CART).toContain("function DiscountRow");
    expect(CART).toContain("w-full min-h-11 px-3 py-2");
  });
});
