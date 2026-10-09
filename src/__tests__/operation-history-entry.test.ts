import { describe, expect, it } from "vitest";
import { auditEntryFilters, auditStoreDate, billAuditHref } from "@/lib/operation-history-entry";

const branch = "11111111-1111-1111-1111-111111111111";
const bill = "22222222-2222-2222-2222-222222222222";
describe("operation history entry", () => {
  it("uses Vietnam's day across midnight regardless of the device zone", () => {
    expect(auditStoreDate(new Date("2026-10-08T16:59:59Z"))).toBe("2026-10-08");
    expect(auditStoreDate(new Date("2026-10-08T17:00:00Z"))).toBe("2026-10-09");
    expect(auditEntryFilters(new URLSearchParams(), new Date("2026-10-08T17:00:00Z"))).toMatchObject({
      branch: "current", source: "all", datePreset: "today", dateFrom: "2026-10-09", dateTo: "2026-10-09", search: "",
    });
  });
  it("opens the exact saved bill in its branch without hiding earlier days", () => {
    const href = billAuditHref(branch, bill, "KB000067 · Bàn 14");
    const params = new URL(href!, "https://onebiz.com.vn").searchParams;
    expect(auditEntryFilters(params)).toMatchObject({ branch, search: bill, label: "KB000067 · Bàn 14", source: "fnb", datePreset: "all", dateFrom: "", dateTo: "" });
  });
  it("rejects offline drafts and incomplete or invalid scope", () => {
    expect(billAuditHref(branch, "local_123", "Nháp")).toBeUndefined();
    expect(billAuditHref(undefined, bill, "Bill")).toBeUndefined();
    expect(auditEntryFilters(new URLSearchParams({ branch: "all", bill }))).toMatchObject({ branch: "current", search: "", datePreset: "today" });
  });
  it("encodes human labels and bounds their size without changing bill identity", () => {
    const href = billAuditHref(branch, bill, "Bàn & giao hàng?".repeat(30));
    const filters = auditEntryFilters(new URL(href!, "https://onebiz.com.vn").searchParams);
    expect(filters.label).toHaveLength(100);
    expect(filters.search).toBe(bill);
  });
});
