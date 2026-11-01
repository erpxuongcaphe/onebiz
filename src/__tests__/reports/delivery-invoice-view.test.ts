import { describe, expect, it } from "vitest";
import { deliveryInvoiceView, filterDeliveryRows, summarizeDeliveryRows, deliveryManagementColumns, sortDeliveryRows } from "@/lib/reports/delivery-invoice-view";
import { canAccessReport, getReportByPath } from "@/lib/reports/catalog";
import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
const row = { id: "one", branchId: "a", branchName: "Quán A", staffId: "staff", staffName: "Nhân viên", orderNumber: "DH-1", invoiceId: "invoice", invoiceCode: "HD-1", invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40, paymentMethod: "cash", deliveryStatus: "assigned", createdAt: "2026-11-01T01:00:00Z", assignedAt: null, completedAt: null, invoiceStatus: "completed", deliveryTier: null } as DeliveryInvoiceRow;
describe("delivery management grain and payment", () => {
  it("keeps invoice payment distinct from staff handover and removes cancelled money from totals", () => {
    const rows = deliveryInvoiceView([row, { ...row, id: "cancel", invoiceId: "cancelled", deliveryStatus: "cancelled", invoiceTotal: 999 }]);
    expect(summarizeDeliveryRows(rows)).toMatchObject({ orders: 2, cancelled: 1, invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40 });
  });
  it("flags duplicate invoice assignments rather than double counting money", () => {
    const rows = deliveryInvoiceView([row, { ...row, id: "two", staffId: "other" }]);
    expect(rows.every(r => r.invoiceDuplicate)).toBe(true);
    expect(summarizeDeliveryRows(rows)).toMatchObject({ orders: 2, invoiceTotal: null, missingInvoice: 2 });
  });
  it("filters Vietnamese substrings and keeps staff scoped by branch", () => {
    const rows = deliveryInvoiceView([row, { ...row, id: "two", branchId: "b", branchName: "Quán B" }]);
    expect(filterDeliveryRows(rows, { search: "nhan vien", staff: "a:staff", status: "assigned", method: "cash" })).toHaveLength(1);
    expect(deliveryManagementColumns(false).some(c => c.key === "invoiceTotal")).toBe(false);
    expect(deliveryManagementColumns(true).map(c => c.key)).toContain("invoiceDebt");
  });
  it("sorts calendar timestamps instead of localized display strings", () => {
    const rows = deliveryInvoiceView([{ ...row, id: "nov", createdAt: "2026-11-01T01:00:00Z" }, { ...row, id: "oct", createdAt: "2026-10-31T09:00:00Z" }]);
    expect(sortDeliveryRows(rows, { id: "createdLabel", direction: "asc" }).map(row => row.id)).toEqual(["oct", "nov"]);
  });
  it("preserves unknown invoice amounts rather than inventing zero", () => {
    expect(summarizeDeliveryRows(deliveryInvoiceView([{ ...row, invoiceId: null, invoiceTotal: null, invoicePaid: null, invoiceDebt: null }]))).toMatchObject({ invoiceTotal: null, invoicePaid: null, invoiceDebt: null });
    expect(summarizeDeliveryRows(deliveryInvoiceView([{ ...row, invoiceTotal: 0, invoicePaid: 0, invoiceDebt: 0 }]))).toMatchObject({ invoiceTotal: 0, invoicePaid: 0, invoiceDebt: 0 });
  });
  it("requires detail permission in addition to either report permission", () => {
    const report = getReportByPath("/phan-tich/fnb-shipper")!;
    expect(canAccessReport(report, key => key === "reports.fnb")).toBe(false);
    expect(canAccessReport(report, key => ["reports.fnb", "reports.view_detail"].includes(key))).toBe(true);
    expect(canAccessReport(report, key => ["reports.analytics", "reports.view_detail"].includes(key))).toBe(true);
  });
});
