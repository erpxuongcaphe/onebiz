import { describe, expect, it } from "vitest";
import { buildAbcReport, type AbcProduct, type AbcSaleLine } from "@/lib/reports/abc-model";

const range = { from: "2026-10-01", to: "2026-10-29" };
const product = (id: string, active = true): AbcProduct => ({ id, code: id, name: id, unit: "Cái", is_active: active });
const line = (id: string, total: number, unit: string | null = "Ly"): AbcSaleLine => ({ product_id: id, product_name: `Lịch sử ${id}`, quantity: 2, total, unit, invoices: { ngay_chung_tu: "2026-10-10T00:00:00Z" } });
describe("ABC report accounting boundaries", () => {
  it("keeps a dominant single product in A rather than C", () => {
    expect(buildAbcReport([product("a")], [line("a", 100)], range).rows[0].abcClass).toBe("A");
  });
  it("includes the crossing item, with exact boundaries starting the next group", () => {
    const report = buildAbcReport([], [line("a", 70), line("b", 10), line("c", 10), line("d", 5), line("e", 5)], range);
    expect(report.rows.map(row => row.abcClass)).toEqual(["A", "A", "B", "B", "C"]);
    expect(report.rows.at(-1)?.cumPct).toBeCloseTo(100);
  });
  it("does not drop inactive or unavailable catalog products with sales", () => {
    const report = buildAbcReport([product("a", false), product("b", false), product("c")], [line("a", 90), line("missing", 10)], range);
    expect(report.rows.map(row => row.productId)).toEqual(["a", "missing", "c"]);
    expect(report.rows[1].name).toBe("Lịch sử missing");
    expect(report.rows.reduce((sum, row) => sum + row.revenue, 0)).toBe(report.totalRevenue);
  });
  it("uses recorded units, not current catalog units", () => {
    const row = buildAbcReport([product("a")], [line("a", 10)], range).rows[0];
    expect(row).toMatchObject({ unit: "Ly", catalogUnit: "Cái", qtySold: 2 });
  });
  it.each([["Ly", "Thùng"], ["Ly", null], [null, null]])("does not sum ambiguous quantities %s %s", (a, b) => {
    const row = buildAbcReport([], [line("a", 10, a), line("a", 20, b)], range).rows[0];
    expect(row.qtySold).toBeNull(); expect(row.revenue).toBe(30);
  });
  it("handles zero sales without fake 100 percent or negative elapsed days", () => {
    const report = buildAbcReport([product("a")], [line("a", 0)], range, 80, 95, 0);
    expect(report.rows[0]).toMatchObject({ abcClass: "slow", pct: 0, cumPct: 0, lastSoldDaysAgo: 0 });
  });
  it("uses a deterministic tie order", () => {
    expect(buildAbcReport([], [line("z", 50), line("a", 50)], range).rows.map(row => row.productId)).toEqual(["a", "z"]);
  });
  it.each([-1, NaN, Infinity])("rejects invalid source revenue %s instead of hiding it", total => {
    expect(() => buildAbcReport([], [line("a", total)], range)).toThrow();
  });
  it.each([[95, 80], [0, 95], [80, 100]])("rejects invalid thresholds %s %s", (a, b) => {
    expect(() => buildAbcReport([], [], range, a, b)).toThrow();
  });
});
