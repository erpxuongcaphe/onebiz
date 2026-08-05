import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatPosQuantityInput,
  parsePosQuantityInput,
  stepPosQuantity,
} from "@/app/pos/lib/quantity-input";

describe("POS decimal quantity input", () => {
  it("preserves dot and comma decimal quantities", () => {
    expect(parsePosQuantityInput("5.17")).toBe(5.17);
    expect(parsePosQuantityInput("5,17")).toBe(5.17);
    expect(parsePosQuantityInput("0.25")).toBe(0.25);
  });

  it("rejects empty, non-positive and over-precision values", () => {
    expect(parsePosQuantityInput("")).toBeNull();
    expect(parsePosQuantityInput("0")).toBeNull();
    expect(parsePosQuantityInput("-1")).toBeNull();
    expect(parsePosQuantityInput("5.171")).toBeNull();
  });

  it("steps fractional quantities without forcing them to one", () => {
    expect(stepPosQuantity(5.17, -1)).toBe(4.17);
    expect(stepPosQuantity(0.5, -1)).toBe(0.01);
    expect(stepPosQuantity(5.17, 1)).toBe(6.17);
    expect(formatPosQuantityInput(5.17)).toBe("5.17");
  });

  it("syncs a valid typed decimal before blur or the F10 shortcut", () => {
    const posPage = readFileSync("src/app/pos/page.tsx", "utf8");
    const variantPicker = readFileSync(
      "src/app/pos/components/variant-picker-dialog.tsx",
      "utf8",
    );

    expect(posPage).toContain("if (parsed !== null) onQtyChange(parsed)");
    expect(variantPicker).toContain("if (parsed !== null) setQuantity(parsed)");
  });

  it("formats invoice and order quantities without dropping decimals", () => {
    const invoicePage = readFileSync("src/app/(main)/don-hang/hoa-don/page.tsx", "utf8");
    const orderPage = readFileSync("src/app/(main)/don-hang/dat-hang/page.tsx", "utf8");

    expect(invoicePage).toContain("formatNumber(Number(item.quantity ?? 0))");
    expect(orderPage).toContain("formatNumber(Number(item.quantity ?? 0))");
  });
});