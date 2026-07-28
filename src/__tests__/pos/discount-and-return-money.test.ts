/**
 * Chốt 3 lỗi tiền sửa 28/07 (Đợt 4 việc 3). Test thuần phép tính — dựng lại
 * đúng công thức trong code để nếu ai sửa ngược lại là gãy ngay.
 */
import { describe, it, expect } from "vitest";

describe("mở lại đơn nháp — không trừ giảm giá hai lần", () => {
  /** Công thức lưu nháp: discount_amount = giảm giá đơn + tổng chiết khấu dòng */
  const luuNhap = (giamGiaDon: number, chietKhauDong: number[]) =>
    giamGiaDon + chietKhauDong.reduce((a, b) => a + b, 0);

  /** Công thức mở lại SAU KHI SỬA: tách phần của dòng ra khỏi phần của đơn */
  const moLai = (discountAmount: number, chietKhauDong: number[]) =>
    Math.max(0, discountAmount - chietKhauDong.reduce((a, b) => a + b, 0));

  const tinhTong = (
    subtotal: number,
    chietKhauDong: number[],
    giamGiaDon: number,
  ) => {
    const lineDisc = chietKhauDong.reduce((a, b) => a + b, 0);
    return Math.max(0, subtotal - lineDisc) - giamGiaDon;
  };

  it("chỉ có chiết khấu dòng: mở lại phải ra cùng số tiền", () => {
    const subtotal = 100_000;
    const ckDong = [10_000];
    const tongGoc = tinhTong(subtotal, ckDong, 0); // 90.000

    const luu = luuNhap(0, ckDong); // 10.000
    const tongSauMoLai = tinhTong(subtotal, ckDong, moLai(luu, ckDong));

    expect(tongGoc).toBe(90_000);
    expect(tongSauMoLai).toBe(tongGoc);
  });

  it("có cả chiết khấu dòng lẫn giảm giá đơn", () => {
    const subtotal = 500_000;
    const ckDong = [20_000, 30_000];
    const giamDon = 50_000;
    const tongGoc = tinhTong(subtotal, ckDong, giamDon); // 400.000

    const luu = luuNhap(giamDon, ckDong); // 100.000
    expect(moLai(luu, ckDong)).toBe(giamDon);
    expect(tinhTong(subtotal, ckDong, moLai(luu, ckDong))).toBe(tongGoc);
  });

  it("cách CŨ (gán nguyên cục) làm thất thu đúng bằng chiết khấu dòng", () => {
    const subtotal = 100_000;
    const ckDong = [10_000];
    const luu = luuNhap(0, ckDong);
    const tongCachCu = tinhTong(subtotal, ckDong, luu); // trừ 2 lần
    expect(tongCachCu).toBe(80_000);
    expect(tinhTong(subtotal, ckDong, moLai(luu, ckDong)) - tongCachCu).toBe(
      10_000,
    );
  });

  it("mở lại nhiều lần vẫn không trôi số", () => {
    const subtotal = 200_000;
    const ckDong = [15_000];
    let giamDon = 0;
    for (let i = 0; i < 5; i++) {
      giamDon = moLai(luuNhap(giamDon, ckDong), ckDong);
    }
    expect(giamDon).toBe(0);
    expect(tinhTong(subtotal, ckDong, giamDon)).toBe(185_000);
  });
});

describe("trả hàng — hoàn theo giá THỰC đã trừ chiết khấu", () => {
  /** Công thức sau khi sửa: giá thực = thành tiền dòng / số lượng */
  const giaThuc = (total: number, quantity: number, unitPrice: number) =>
    quantity > 0 ? total / quantity : unitPrice;

  it("dòng có chiết khấu: hoàn theo giá khách thực trả", () => {
    // Mua 2 cái, niêm yết 50k, chiết khấu 30k cả dòng → total 70k
    const g = giaThuc(70_000, 2, 50_000);
    expect(g).toBe(35_000);
    expect(2 * g).toBe(70_000); // trả cả 2 → hoàn đúng 70k, không phải 100k
  });

  it("trả một phần cũng theo giá thực", () => {
    const g = giaThuc(70_000, 2, 50_000);
    expect(1 * g).toBe(35_000);
  });

  it("dòng không chiết khấu: giá thực = giá niêm yết", () => {
    expect(giaThuc(100_000, 2, 50_000)).toBe(50_000);
  });

  it("số lượng 0 (không xảy ra) thì lùi về giá niêm yết", () => {
    expect(giaThuc(0, 0, 50_000)).toBe(50_000);
  });
});

describe("trả hàng — cấn công nợ phải trừ nợ thật", () => {
  /** Công thức sau khi sửa trong completeReturn */
  const canNo = (tongTra: number, hoanTien: number, noHienTai: number) => {
    const credit = Math.max(0, tongTra - hoanTien);
    return Math.min(credit, noHienTai);
  };

  it("chọn cấn nợ hoàn toàn: nợ giảm đúng số tiền trả", () => {
    expect(canNo(500_000, 0, 2_000_000)).toBe(500_000);
  });

  it("hoàn một phần tiền, phần còn lại cấn nợ", () => {
    expect(canNo(500_000, 200_000, 2_000_000)).toBe(300_000);
  });

  it("hoàn hết bằng tiền mặt: không đụng nợ", () => {
    expect(canNo(500_000, 500_000, 2_000_000)).toBe(0);
  });

  it("khách hết nợ mà chọn cấn nợ: KHÔNG tạo nợ âm", () => {
    expect(canNo(500_000, 0, 0)).toBe(0);
  });

  it("cấn nhiều hơn nợ còn lại: chỉ cấn tối đa phần đang nợ", () => {
    expect(canNo(500_000, 0, 120_000)).toBe(120_000);
  });
});
