import { describe, expect, it } from "vitest";
import { deliveryInvoiceView, filterDeliveryRows, summarizeDeliveryRows, deliveryManagementColumns } from "@/lib/reports/delivery-invoice-view";
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
    expect(summarizeDeliveryRows(rows)).toMatchObject({ orders: 2, invoiceTotal: 0, missingInvoice: 2 });
  });
  it("filters Vietnamese substrings and keeps staff scoped by branch", () => {
    const rows = deliveryInvoiceView([row, { ...row, id: "two", branchId: "b", branchName: "Quán B" }]);
    expect(filterDeliveryRows(rows, { search: "nhan vien", staff: "a:staff", status: "assigned", method: "cash" })).toHaveLength(1);
    expect(deliveryManagementColumns(false).some(c => c.key === "invoiceTotal")).toBe(false);
    expect(deliveryManagementColumns(true).map(c => c.key)).toContain("invoiceDebt");
  });
});
