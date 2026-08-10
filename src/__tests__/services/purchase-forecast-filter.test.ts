import { describe, expect, it } from "vitest";
import {
  filterPurchaseForecastRows,
  normalizePurchaseForecastQuery,
} from "@/lib/utils/purchase-forecast-filter";

const rows = [
  { code: "NVL-SUA-001", name: "Sữa đặc", quantity: 10 },
  { code: "SKU-TPP-012", name: "Trân Châu Trắng", quantity: 3 },
];

describe("purchase forecast item filter", () => {
  it("normalizes surrounding whitespace and Vietnamese casing", () => {
    expect(normalizePurchaseForecastQuery("  TRÂN CHÂU ")).toBe("trân châu");
  });

  it("finds materials and SKU by code", () => {
    expect(filterPurchaseForecastRows(rows, "nvl-sua")).toEqual([rows[0]]);
    expect(filterPurchaseForecastRows(rows, "SKU-TPP")).toEqual([rows[1]]);
  });

  it("finds by Vietnamese product name", () => {
    expect(filterPurchaseForecastRows(rows, "trân châu")).toEqual([rows[1]]);
  });

  it("keeps all rows for a blank query", () => {
    expect(filterPurchaseForecastRows(rows, "   ")).toBe(rows);
  });
});
