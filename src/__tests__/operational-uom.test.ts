import { describe, expect, it } from "vitest";
import { operationalFactor, quantityToStock, stockToInput, switchInputQuantity, preferredWeighingUnit } from "@/lib/operational-uom";
import type { UOMConversion } from "@/lib/types";
const conversion = (fromUnit: string, toUnit: string, factor: number, isActive = true) => ({fromUnit,toUnit,factor,isActive}) as UOMConversion;
describe("declared operational units", () => {
  it("uses the two existing prepared-product factors and ignores their misleading names", () => {
    expect(quantityToStock(550,"Mẻ","G",[conversion("Mẻ","G",1100)])).toBe(.5);
    expect(quantityToStock(375,"Mẻ/100g","G",[conversion("Mẻ/100g","G",750)])).toBe(.5);
    expect(preferredWeighingUnit("Mẻ",[conversion("Mẻ","G",1100)])).toBe("G");
  });
  it("preserves physical quantities through repeated entry-unit changes without posting rounding", () => {
    const units=[conversion("Mẻ","G",1100)]; let amount=1;
    for(let i=0;i<100;i++) {
      amount=switchInputQuantity(amount,"Mẻ","G","Mẻ",units)!;
      amount=switchInputQuantity(amount,"Mẻ","Mẻ","G",units)!;
    }
    expect(amount).toBeCloseTo(1,12);
  });
  it("matches the four-decimal stock ledger and exposes the inverse recorded weight", () => {
    const units=[conversion("Mẻ","G",1100)];
    const posted=quantityToStock(1,"Mẻ","G",units)!;
    expect(posted).toBe(.0009);
    expect(stockToInput(posted,"Mẻ","G",units)).toBe(.99);
    expect(quantityToStock(.001,"Mẻ","G",units)).toBe(0);
  });
  it("does not guess density, trust inactive factors or pick an ambiguous mapping", () => {
    expect(operationalFactor("G","ml",[])).toBeNull();
    expect(operationalFactor("Mẻ","G",[conversion("Mẻ","G",1100,false)])).toBeNull();
    expect(operationalFactor("Mẻ","G",[conversion("Mẻ","G",1100),conversion("Mẻ","G",1000)])).toBeNull();
    expect(quantityToStock(Infinity,"G","G",[])).toBeNull();
  });
  it("shows negative and zero physical equivalents without changing stock", () => {
    const units=[conversion("Túi","G",500)];
    expect(stockToInput(-.2,"Túi","G",units)).toBe(-100);
    expect(stockToInput(0,"Túi","G",units)).toBe(0);
  });
});
