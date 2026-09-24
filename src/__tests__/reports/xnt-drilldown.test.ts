import { describe, expect, it } from "vitest";
import { buildXntMovementHref, readXntMovementFilter } from "@/lib/reports/xnt-drilldown";

const productId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const branchId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("XNT movement drilldown", () => {
  it("carries exact product, branch and inclusive reporting dates", () => {
    const href = buildXntMovementHref({
      productId,
      productCode: "SKU-SUA-001",
      branchId,
      from: "2026-09-01",
      to: "2026-09-24",
    });
    expect(href.startsWith("/hang-hoa/lich-su-kho?")).toBe(true);
    expect(readXntMovementFilter(href.split("?")[1])).toEqual({
      productId,
      productCode: "SKU-SUA-001",
      branchId,
      from: "2026-09-01",
      to: "2026-09-24",
    });
  });

  it("rejects malformed or reversed scope instead of broadening the query", () => {
    expect(readXntMovementFilter("productId=bad&from=2026-09-01&to=2026-09-24")).toBeNull();
    expect(readXntMovementFilter(`productId=${productId}&from=2026-09-24&to=2026-09-01`)).toBeNull();
    expect(readXntMovementFilter(`productId=${productId}&from=bad&to=2026-09-24`)).toBeNull();
  });
});
