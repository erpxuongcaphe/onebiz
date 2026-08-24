import { describe, expect, it } from "vitest";
import { kiemTraGiaBanThemNhanhFnb } from "@/app/pos/fnb/fnb-menu-sale-guard";

describe("kiemTraGiaBanThemNhanhFnb", () => {
  it("chặn món một giá chưa cấu hình giá trước khi nó vào giỏ", () => {
    expect(
      kiemTraGiaBanThemNhanhFnb({ catalogPrice: 0, resolvedPrice: 0 }),
    ).toEqual({
      dat: false,
      lyDo: "Món chưa có giá bán. Nhập giá trước khi thêm vào giỏ.",
    });
  });

  it("chặn giá kênh giao hàng bằng 0 dù giá niêm yết hợp lệ", () => {
    expect(
      kiemTraGiaBanThemNhanhFnb({ catalogPrice: 35_000, resolvedPrice: 0 }),
    ).toEqual({
      dat: false,
      lyDo: "Giá bán của kênh hiện tại chưa hợp lệ. Kiểm tra lại giá trước khi bán.",
    });
  });

  it("cho thêm nhanh khi cả giá niêm yết và giá thực bán đều hợp lệ", () => {
    expect(
      kiemTraGiaBanThemNhanhFnb({ catalogPrice: 35_000, resolvedPrice: 40_000 }),
    ).toEqual({ dat: true });
  });
});
