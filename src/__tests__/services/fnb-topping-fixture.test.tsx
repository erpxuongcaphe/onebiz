import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FnbItemDialog } from "@/app/pos/fnb/components/fnb-item-dialog";
import {
  apDungCheDoTopping,
  CHE_DO_TOPPING_SKU,
} from "@/lib/services/supabase/fnb-toppings";

/**
 * 08/08/2026 — CEO chốt: KHÔNG dùng dữ liệu production để kiểm topping.
 * Toàn bộ ca "topping 8.000đ/phần, tính tiền, mở lại món" chạy bằng FIXTURE
 * ngay tại đây; và cờ chuyển đổi cơ chế topping phải mặc định TẮT (bảo toàn
 * hệ thống hiện tại).
 */

const SP = { id: "sp-tra-sua", name: "Trà sữa trân châu", sell_price: 35000 };
const TOPPING_8K = [{ id: "tpp-012", name: "Trân Châu Trắng", price: 8000 }];

function moPopup(props: Partial<React.ComponentProps<typeof FnbItemDialog>> = {}) {
  return render(
    <FnbItemDialog
      open
      onOpenChange={() => {}}
      product={SP}
      onConfirm={() => {}}
      toppings={TOPPING_8K}
      // Món không có nhóm tuỳ chọn — cô lập phép tính topping
      dynamicModifiers={{ groups: [], optionsByGroup: new Map() }}
      {...props}
    />,
  );
}

describe("Fixture topping 8.000đ/phần — tính tiền (không cần dữ liệu prod)", () => {
  it("2 phần topping: 35.000 + 2×8.000 = 51.000đ, KHÔNG cộng hai lần", () => {
    moPopup();
    const them = screen.getByLabelText("Thêm topping");
    fireEvent.click(them);
    fireEvent.click(them);
    expect(screen.getByText(/Thêm vào đơn — 51.000đ/)).toBeTruthy();
  });

  it("2 phần × 2 ly: (35.000 + 16.000) × 2 = 102.000đ (nhân số phần × số ly)", () => {
    moPopup();
    const them = screen.getByLabelText("Thêm topping");
    fireEvent.click(them);
    fireEvent.click(them);
    // Nút tăng SỐ LƯỢNG LY — dialog mới có aria-label "Thêm số lượng";
    // fallback cho bản cũ: icon "add" không nhãn (khác nút topping).
    const tangLy =
      screen.queryByLabelText("Thêm số lượng") ??
      screen
        .getAllByRole("button")
        .find(
          (b) =>
            b.textContent?.trim() === "add" && !b.getAttribute("aria-label"),
        )!;
    fireEvent.click(tangLy);
    expect(screen.getByText(/Thêm vào đơn — 102.000đ/)).toBeTruthy();
  });

  it("payload gửi đi: đúng productId + quantity + giá MỘT PHẦN", () => {
    const onConfirm = vi.fn();
    moPopup({ onConfirm });
    const them = screen.getByLabelText("Thêm topping");
    fireEvent.click(them);
    fireEvent.click(them);
    fireEvent.click(screen.getByText(/Thêm vào đơn/).closest("button")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0][0];
    expect(payload.toppings).toEqual([
      { productId: "tpp-012", name: "Trân Châu Trắng", quantity: 2, price: 8000 },
    ]);
    expect(payload.unitPrice).toBe(35000);
    expect(payload.quantity).toBe(1);
  });

  it("MỞ LẠI món (chế độ Sửa): giữ đúng lựa chọn topping và tổng tiền", () => {
    moPopup({
      initialSelection: { toppings: [{ id: "tpp-012", quantity: 2 }] },
      confirmLabel: "Cập nhật",
    });
    // Tổng khớp y lần đầu — không cộng lại, không mất phần nào
    expect(screen.getByText(/Cập nhật — 51.000đ/)).toBeTruthy();
  });

  it("KHÔNG có topping hợp lệ (prop undefined) → không render khu topping, không lỗi", () => {
    moPopup({ toppings: undefined });
    expect(screen.queryByLabelText("Thêm topping")).toBeNull();
    expect(screen.getByText(/Thêm vào đơn — 35.000đ/)).toBeTruthy();
  });
});

describe("Cờ chuyển đổi cơ chế topping — an toàn, mặc định TẮT", () => {
  const NHOM = [
    { id: "g1", rule: "single_required", name: "Size" },
    { id: "g2", rule: "single", name: "Mức đường" },
    { id: "g3", rule: "multi", name: "Topping (cũ)" },
  ];

  it("mặc định cờ TẮT — bảo toàn hệ thống hiện tại", () => {
    // Test chạy không set NEXT_PUBLIC_FNB_TOPPING_SKU → phải là false.
    expect(CHE_DO_TOPPING_SKU).toBe(false);
  });

  it("cờ TẮT: giữ NGUYÊN mọi nhóm tuỳ chọn (kể cả Topping cũ)", () => {
    expect(apDungCheDoTopping(NHOM, false)).toEqual(NHOM);
  });

  it("cờ BẬT: ẩn nhóm CHỌN-NHIỀU (cơ chế topping cũ), giữ Size/Đường", () => {
    expect(apDungCheDoTopping(NHOM, true).map((g) => g.id)).toEqual(["g1", "g2"]);
  });
});

/** Soi mã sau khi loại chú thích — bài học chú thích chứa đúng chuỗi đang tìm. */
function boChuThich(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
}

describe("Khoá: POS FnB đấu cờ đúng 2 chỗ, không hiện 2 cơ chế", () => {
  const trang = boChuThich(readFileSync("src/app/pos/fnb/page.tsx", "utf8"));

  it("khu topping SKU chỉ hiện khi CỜ BẬT", () => {
    expect(trang).toContain("CHE_DO_TOPPING_SKU && toppingProducts.length > 0");
  });

  it("nhóm tuỳ chọn đi qua bộ lọc theo cơ chế topping", () => {
    expect(trang).toContain("locNhomTheoCheDoTopping(itemModifierData.groups)");
  });

  it("dialog không render khu topping rỗng (không khoảng trống thừa)", () => {
    const dialog = boChuThich(
      readFileSync("src/app/pos/fnb/components/fnb-item-dialog.tsx", "utf8"),
    );
    expect(dialog).toContain("toppings && toppings.length > 0 &&");
  });
});
