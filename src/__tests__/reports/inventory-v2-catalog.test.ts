import { describe, expect, it } from "vitest";
import { canAccessReport, getReportByPath } from "@/lib/reports/catalog";

describe("inventory V2 catalog access", () => {
  const report = getReportByPath("/phan-tich/aging")!;
  it("names the current report and requires analytics plus detail only", () => {
    expect(report.title).toBe("Tồn kho và luân chuyển");
    expect(report.shortTitle).toBe(report.title);
    expect(report.permissions).toEqual(["reports.analytics", "reports.view_detail"]);
    expect(report.permissionMode).toBe("all");
  });
  it.each([
    { permissions: [], allowed: false },
    { permissions: ["reports.analytics"], allowed: false },
    { permissions: ["reports.view_detail"], allowed: false },
    { permissions: ["products.view_cost"], allowed: false },
    { permissions: ["reports.analytics", "products.view_cost"], allowed: false },
    { permissions: ["reports.view_detail", "products.view_cost"], allowed: false },
    { permissions: ["reports.analytics", "reports.view_detail"], allowed: true },
    { permissions: ["reports.analytics", "reports.view_detail", "products.view_cost"], allowed: true },
  ])("aligns catalog access for $permissions", ({ permissions, allowed }) => {
    expect(canAccessReport(report, permission => permissions.includes(permission))).toBe(allowed);
  });
});
