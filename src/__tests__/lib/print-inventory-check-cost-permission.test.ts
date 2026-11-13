import { describe, expect, it } from "vitest";
import { buildInventoryCheckPrintData } from "@/lib/print-templates";
import { formatCurrency } from "@/lib/format";

type Check = Parameters<typeof buildInventoryCheckPrintData>[0];
const check = {
  code: "KK01", date: "2026-11-12", createdBy: "user", status: "balanced",
  totalProducts: 3, increaseQty: 2, decreaseQty: 1,
  increaseAmount: 150000, decreaseAmount: 50000,
} as Check;

describe("stocktake print cost visibility", () => {
  it("retains counts but omits all monetary values without cost permission", () => {
    const rows = buildInventoryCheckPrintData(check, false).summaryRows ?? [];
    expect(rows.map((row) => row.label)).toEqual(["SL lệch tăng", "SL lệch giảm"]);
    expect(JSON.stringify(rows)).not.toContain("150.000");
  });

  it("retains monetary amounts when cost permission is granted", () => {
    const rows = buildInventoryCheckPrintData(check, true).summaryRows ?? [];
    expect(rows.map((row) => row.label)).toEqual([
      "SL lệch tăng", "SL lệch giảm", "GT tăng", "GT giảm", "Tổng chênh lệch",
    ]);
    expect(rows.find((row) => row.label === "Tổng chênh lệch")?.value).toContain(formatCurrency(100000));
  });
});
