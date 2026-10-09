import { describe, expect, it } from "vitest";
import type { StaffRevenueRow } from "@/lib/services/supabase/sales-reports";
import { staffRevenueView } from "@/lib/reports/staff-revenue-view";

const row = (staffId: string, revenue: number, branchName: string): StaffRevenueRow => ({
  staffId, staffName: `NV ${staffId}`, staffRole: null, branchId: branchName,
  branchName, source: "pos", invoiceCount: 1, totalRevenue: revenue,
  avgOrderValue: revenue, customerCount: 1, firstOrderAt: null, lastOrderAt: null,
});

describe("staff revenue display/export scope", () => {
  const rows = [row("A", 20, "Kho Tổng"), row("B", 100, "Xưởng Tư Búa"), row("C", 5, "Kho Tổng")];
  it("defaults to numerical revenue ranking without mutating the source", () => {
    expect(staffRevenueView(rows, "", null).map(r => r.staffId)).toEqual(["B", "A", "C"]);
    expect(rows.map(r => r.staffId)).toEqual(["A", "B", "C"]);
  });
  it("filters complete rows before sorting for display and Excel", () => {
    const view = staffRevenueView(rows, " kho tổng ", { id: "totalRevenue", direction: "asc" });
    expect(view.map(r => r.staffId)).toEqual(["C", "A"]);
    expect(view.reduce((sum, r) => sum + r.totalRevenue, 0)).toBe(25);
  });
  it("keeps absent dates last in both directions", () => {
    const dated = [{ ...rows[0], lastOrderAt: "2026-10-01" }, rows[1]];
    for (const direction of ["asc", "desc"] as const) {
      expect(staffRevenueView(dated, "", { id: "lastOrderAt", direction })[1].staffId).toBe("B");
    }
  });
});
