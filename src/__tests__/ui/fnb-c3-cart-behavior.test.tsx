import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FnbCart } from "../../app/pos/fnb/components/fnb-cart";
import type { FnbOrderLine, FnbTabSnapshot } from "@/lib/types/fnb";

/**
 * C3 — test HÀNH VI render FnbCart bằng props giả (CEO 18/08: bù 3 khoảng
 * trống dữ liệu thật không dựng được — 20 dòng, quantity 5.17, món đủ
 * Size/Đường/Đá/Topping/ghi chú dài — và cơ chế thu gọn màn thấp).
 * Render thật qua jsdom, KHÔNG quét chuỗi mã.
 */

function taoDong(i: number, ghiDe: Partial<FnbOrderLine> = {}): FnbOrderLine {
  return {
    id: `line-${i}`,
    productId: `sp-${i}`,
    productName: `Món kiểm thử số ${i}`,
    unitPrice: 45000,
    quantity: 1,
    lineTotal: 45000,
    toppings: [],
    note: "",
    ...ghiDe,
  } as FnbOrderLine;
}

/** Đếm SPAN có textContent đúng bằng chuỗi cần tìm (JSX tách text node). */
function demSpan(container: HTMLElement, text: string): number {
  return [...container.querySelectorAll("span")].filter(
    (s) => s.textContent?.trim() === text,
  ).length;
}

function renderGio(lines: FnbOrderLine[], them: Record<string, unknown> = {}) {
  const tab = {
    id: "tab-1",
    label: "Mang về #1",
    orderType: "takeaway",
    lines,
  } as unknown as FnbTabSnapshot;
  return render(
    <FnbCart
      activeTab={tab}
      subtotal={lines.reduce((s, l) => s + l.lineTotal, 0)}
      total={lines.reduce((s, l) => s + l.lineTotal, 0)}
      orderDiscountAmount={0}
      lineCount={lines.length}
      updateLineQty={() => {}}
      removeLine={() => {}}
      onSendToKitchen={() => {}}
      kitchenSubmitting={false}
      onPayment={() => {}}
      {...(them as object)}
    />,
  );
}

describe("C3 hành vi — fixture 20 dòng", () => {
  it("render đủ 20 dòng, mỗi dòng có nút xoá + đơn giá × SL", () => {
    const { container } = renderGio(
      Array.from({ length: 20 }, (_, i) => taoDong(i)),
    );
    expect(screen.getAllByLabelText("Xoá món")).toHaveLength(20);
    // format.ts dùng NUMBER_LOCALE en-US: nghìn dấu PHẨY, thập phân dấu CHẤM.
    expect(demSpan(container, "45,000 × 1")).toBe(20);
  });
});

describe("C3 hành vi — quantity thập phân 5.17 + giá 9 chữ số", () => {
  it("hiện '5.17' nguyên vẹn và đơn giá 9 số không cắt", () => {
    const { container } = renderGio([
      taoDong(1, {
        quantity: 5.17,
        unitPrice: 123456789,
        lineTotal: 638271599.13,
      }),
    ]);
    // formatNumber (en-US) giữ thập phân "5.17" nguyên vẹn: ô SL + dòng đơn giá.
    expect(demSpan(container, "5.17")).toBeGreaterThanOrEqual(1);
    expect(demSpan(container, "123,456,789 × 5.17")).toBe(1);
  });
});

describe("C3 hành vi — món đủ Size + Đường + Đá + topping + ghi chú dài", () => {
  it("dòng phụ hiện đủ, không mất lựa chọn quan trọng", () => {
    const ghiChu =
      "Ít ngọt thôi, nhiều đá, để riêng trân châu, giao trước 5 giờ chiều cho chị Hằng ở quầy lễ tân toà nhà B";
    renderGio([
      taoDong(1, {
        productName: "Trà Sữa Trân Châu Đường Đen Đặc Biệt Phiên Bản Giới Hạn",
        variantLabel: "Size L · Đường 50% · Ít đá",
        toppings: [
          { name: "Trân châu đường đen", quantity: 2, price: 7000 },
          { name: "Pudding trứng nướng", quantity: 1, price: 10000 },
          { name: "Kem cheese", quantity: 1, price: 12000 },
        ],
        note: ghiChu,
      } as Partial<FnbOrderLine>),
    ]);
    expect(screen.getByText(/Size L · Đường 50% · Ít đá/)).toBeInTheDocument();
    expect(screen.getByText(/Trân châu đường đen/)).toBeInTheDocument();
    expect(screen.getByText(/Pudding trứng nướng/)).toBeInTheDocument();
    expect(screen.getByText(/Kem cheese/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(ghiChu.slice(0, 30)))).toBeInTheDocument();
  });
});

describe("C3 hành vi — thu gọn màn thấp KHÔNG ẩn cứng chức năng", () => {
  it("nút 'Ưu đãi & thêm' mở nhóm phụ: class ẩn-màn-thấp được gỡ, không remount", () => {
    renderGio([taoDong(1)], {
      onDiscountChange: () => {},
      onApplyCoupon: () => {},
    });
    const nut = screen.getByRole("button", { name: /Ưu đãi/ });
    expect(nut).toHaveAttribute("aria-expanded", "false");
    const inputTruoc = screen.getByPlaceholderText("Nhập mã khuyến mãi");
    const nhom = inputTruoc.closest('div[class*="space-y-3"]')!;
    expect(nhom.className).toContain("[@media(max-height:540px)]:hidden");

    fireEvent.click(nut);
    expect(nut).toHaveAttribute("aria-expanded", "true");
    // Class ẩn được gỡ → bàn phím mở (màn thấp) vẫn thấy ô đang nhập.
    expect(nhom.className).not.toContain("[@media(max-height:540px)]:hidden");
    // KHÔNG remount: vẫn đúng node input cũ, nội dung gõ dở giữ nguyên.
    fireEvent.change(inputTruoc, { target: { value: "GIAM10" } });
    expect(screen.getByPlaceholderText("Nhập mã khuyến mãi")).toBe(inputTruoc);
    expect((inputTruoc as HTMLInputElement).value).toBe("GIAM10");
  });

  it("đang có giảm giá + coupon: tóm tắt LUÔN hiện trên nút thu gọn", () => {
    renderGio([taoDong(1)], {
      orderDiscountAmount: 15000,
      onDiscountChange: () => {},
      onApplyCoupon: () => {},
      appliedCouponCode: "HE2026",
    });
    const nut = screen.getByRole("button", { name: /Ưu đãi/ });
    expect(nut.textContent).toContain("−15,000");
    expect(nut.textContent).toContain("HE2026");
  });
});
