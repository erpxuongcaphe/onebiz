import { describe, it, expect } from "vitest";
import {
  revenueHeaders,
  validateRevenueRows,
} from "@/lib/operations/revenue-import";
import { isOperationsHubHost } from "@/lib/operations/routing";
const branch = { id: "test", code: "TB" };
const row = [
  "TB",
  "10/2026",
  "1,234.56",
  "POS ngoài",
  "Doanh thu thuần",
  "Báo cáo 01",
  "report-01",
];
describe("Operations revenue import", () => {
  it("parses US numbers to exact cents", () =>
    expect(
      validateRevenueRows([[...revenueHeaders], row], branch).rows[0]
        .amountCents,
    ).toBe(123456));
  it.each(["1.234,56", "1,23", "123.456", "1e6", Infinity, NaN, ""])(
    "rejects invalid amount %s without committing any row",
    (amount) => {
      const result = validateRevenueRows(
        [
          [...revenueHeaders],
          row,
          row.map((v, i) => (i === 2 ? amount : i === 6 ? "other" : v)),
        ],
        branch,
      );
      expect(result.rows).toEqual([]);
      expect(
        result.issues.some((e) => e.row === 3 && e.column === "Doanh thu"),
      ).toBe(true);
    },
  );
  it("accepts ordinary Excel numeric cells", () =>
    expect(
      validateRevenueRows(
        [[...revenueHeaders], row.map((v, i) => (i === 2 ? 1.1 : v))],
        branch,
      ).rows[0].amountCents,
    ).toBe(110));
  it("rejects duplicate source keys", () =>
    expect(
      validateRevenueRows([[...revenueHeaders], row, row], branch).issues.some(
        (e) => e.column === "Khóa bản ghi",
      ),
    ).toBe(true));
  it("rejects different branches", () =>
    expect(
      validateRevenueRows([[...revenueHeaders], row], { ...branch, code: "DX" })
        .rows,
    ).toEqual([]));
  it("rejects headers with missing columns", () =>
    expect(
      validateRevenueRows([revenueHeaders.slice(0, -1), row], branch).rows,
    ).toEqual([]));
  it("rejects empty files", () =>
    expect(
      validateRevenueRows([[...revenueHeaders]], branch).issues,
    ).not.toHaveLength(0));
  it("rejects excessive imports", () =>
    expect(
      validateRevenueRows(
        [
          [...revenueHeaders],
          ...Array.from({ length: 101 }, (_, i) =>
            row.map((v, j) => (j === 6 ? String(i) : v)),
          ),
        ],
        branch,
      ).rows,
    ).toEqual([]));
  it.each(["13/2026", "2026-10", "10/26", "1/2026"])(
    "rejects invalid period %s",
    (period) =>
      expect(
        validateRevenueRows(
          [[...revenueHeaders], row.map((v, i) => (i === 1 ? period : v))],
          branch,
        ).rows,
      ).toEqual([]),
  );
});
describe("Hub domain isolation", () => {
  it.each(["hub.onebiz.com.vn", "hub.localhost:3040"])(
    "recognizes %s",
    (host) => expect(isOperationsHubHost(host)).toBe(true),
  );
  it.each([
    "onebiz.com.vn",
    "fnb.onebiz.com.vn",
    "mkthub.onebiz.com.vn",
    "hub.onebiz.com.vn.attacker.com",
    null,
  ])("does not alter %s routing", (host) =>
    expect(isOperationsHubHost(host)).toBe(false),
  );
});
