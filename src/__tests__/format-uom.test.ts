import { describe, it, expect } from "vitest";
import {
  formatStockConversion,
  pickBestConversion,
  getConversionText,
} from "@/lib/format-uom";
import type { UOMConversion } from "@/lib/types";

const CONV_THUNG_HOP: UOMConversion = {
  id: "c1",
  tenantId: "t1",
  productId: "p1",
  fromUnit: "thùng",
  toUnit: "hộp",
  factor: 12,
  isActive: true,
  createdAt: "",
};

const CONV_BAO_KG: UOMConversion = {
  id: "c2",
  tenantId: "t1",
  productId: "p2",
  fromUnit: "bao",
  toUnit: "kg",
  factor: 60,
  isActive: true,
  createdAt: "",
};

const CONV_LOC_LON: UOMConversion = {
  id: "c3",
  tenantId: "t1",
  productId: "p3",
  fromUnit: "lốc",
  toUnit: "lon",
  factor: 6,
  isActive: true,
  createdAt: "",
};

describe("formatStockConversion — phép chia có dư (Euclidean)", () => {
  it("số chẵn đúng: 24 hộp → 2 thùng", () => {
    expect(formatStockConversion(24, CONV_THUNG_HOP)).toBe("2 thùng");
  });

  it("số lẻ: 25 hộp → 2 thùng 1 lẻ", () => {
    expect(formatStockConversion(25, CONV_THUNG_HOP)).toBe("2 thùng 1 lẻ");
  });

  it("số lẻ nhiều: 31 hộp → 2 thùng 7 lẻ", () => {
    expect(formatStockConversion(31, CONV_THUNG_HOP)).toBe("2 thùng 7 lẻ");
  });

  it("số lớn: 132 hộp → 11 thùng", () => {
    expect(formatStockConversion(132, CONV_THUNG_HOP)).toBe("11 thùng");
  });

  it("đúng 1 đơn vị lớn: 12 hộp → 1 thùng", () => {
    expect(formatStockConversion(12, CONV_THUNG_HOP)).toBe("1 thùng");
  });

  it("chưa đủ 1 đơn vị lớn: 11 hộp → null", () => {
    expect(formatStockConversion(11, CONV_THUNG_HOP)).toBeNull();
  });

  it("qty = 0 → null", () => {
    expect(formatStockConversion(0, CONV_THUNG_HOP)).toBeNull();
  });

  it("qty âm → null (defensive)", () => {
    expect(formatStockConversion(-5, CONV_THUNG_HOP)).toBeNull();
  });

  it("factor 0 → null (defensive)", () => {
    expect(
      formatStockConversion(24, { fromUnit: "thùng", factor: 0 }),
    ).toBeNull();
  });

  it("bao/kg: 120 kg → 2 bao", () => {
    expect(formatStockConversion(120, CONV_BAO_KG)).toBe("2 bao");
  });

  it("bao/kg lẻ: 125 kg → 2 bao 5 lẻ", () => {
    expect(formatStockConversion(125, CONV_BAO_KG)).toBe("2 bao 5 lẻ");
  });

  it("số thập phân lẻ: 12.5 hộp → 1 thùng 0.5 lẻ", () => {
    expect(formatStockConversion(12.5, CONV_THUNG_HOP)).toBe(
      "1 thùng 0.5 lẻ",
    );
  });

  it("NaN/Infinity → null", () => {
    expect(formatStockConversion(NaN, CONV_THUNG_HOP)).toBeNull();
    expect(formatStockConversion(Infinity, CONV_THUNG_HOP)).toBeNull();
  });
});

describe("pickBestConversion — match đúng đơn vị", () => {
  it("match toUnit = 'hộp' → trả conversion thùng↔hộp", () => {
    const c = pickBestConversion("hộp", [CONV_THUNG_HOP]);
    expect(c?.fromUnit).toBe("thùng");
  });

  it("toUnit không match → null", () => {
    expect(pickBestConversion("lon", [CONV_THUNG_HOP])).toBeNull();
  });

  it("conversions rỗng → null", () => {
    expect(pickBestConversion("hộp", [])).toBeNull();
    expect(pickBestConversion("hộp", null)).toBeNull();
    expect(pickBestConversion("hộp", undefined)).toBeNull();
  });

  it("nhiều conversion cùng toUnit → ưu tiên factor lớn nhất", () => {
    const small: UOMConversion = { ...CONV_LOC_LON, factor: 6 };
    const big: UOMConversion = {
      ...CONV_LOC_LON,
      id: "c4",
      fromUnit: "thùng",
      factor: 24,
    };
    const picked = pickBestConversion("lon", [small, big]);
    expect(picked?.fromUnit).toBe("thùng");
    expect(picked?.factor).toBe(24);
  });

  it("ẩn conversion is_active=false", () => {
    const inactive: UOMConversion = { ...CONV_THUNG_HOP, isActive: false };
    expect(pickBestConversion("hộp", [inactive])).toBeNull();
  });
});

describe("getConversionText — full pipeline", () => {
  it("24 hộp → '2 thùng'", () => {
    expect(getConversionText(24, "hộp", [CONV_THUNG_HOP])).toBe("2 thùng");
  });

  it("25 hộp → '2 thùng 1 lẻ'", () => {
    expect(getConversionText(25, "hộp", [CONV_THUNG_HOP])).toBe(
      "2 thùng 1 lẻ",
    );
  });

  it("11 hộp (chưa đủ) → null", () => {
    expect(getConversionText(11, "hộp", [CONV_THUNG_HOP])).toBeNull();
  });

  it("SP không có conversion → null", () => {
    expect(getConversionText(24, "hộp", [])).toBeNull();
    expect(getConversionText(24, "hộp", null)).toBeNull();
  });

  it("unit không match toUnit → null", () => {
    expect(getConversionText(24, "kg", [CONV_THUNG_HOP])).toBeNull();
  });
});
