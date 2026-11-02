import { describe, expect, it } from "vitest";
import { createDeliveryFilters, DELIVERY_INVOICE_STATUS_LABELS, deliveryInvoiceView, deliverySortValue, filterDeliveryRows, summarizeDeliveryRows, deliveryManagementColumns, sortDeliveryRows, type DeliveryFilters } from "@/lib/reports/delivery-invoice-view";
import { canAccessReport, getReportByPath } from "@/lib/reports/catalog";
import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
const row = { id: "one", branchId: "a", branchName: "Quán A", staffId: "staff", staffName: "Nhân viên", orderNumber: "DH-1", invoiceId: "invoice", invoiceCode: "HD-1", invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40, paymentMethod: "cash", deliveryStatus: "assigned", createdAt: "2026-11-01T01:00:00Z", assignedAt: null, completedAt: null, invoiceStatus: "completed", deliveryTier: null } as DeliveryInvoiceRow;
describe("delivery management grain and payment", () => {
  it("treats both transfer source codes as one payment method", () => {
    const rows = deliveryInvoiceView([{ ...row, paymentMethod: "transfer" }, { ...row, id: "bank", paymentMethod: "bank_transfer" }, { ...row, id: "cash", paymentMethod: "cash" }]);
    expect(filterDeliveryRows(rows, { search: "", staff: "", status: "", method: "transfer" }).map(item => item.id)).toEqual(["one", "bank"]);
  });
  it("does not treat missing delivery fees as an actual zero", () => {
    expect(summarizeDeliveryRows(deliveryInvoiceView([{ ...row, deliveryFee: null }])).deliveryFee).toBeNull();
    expect(summarizeDeliveryRows(deliveryInvoiceView([{ ...row, deliveryFee: 0 }])).deliveryFee).toBe(0);
    expect(summarizeDeliveryRows(deliveryInvoiceView([{ ...row, deliveryFee: null }, { ...row, id: "known", deliveryFee: 15 }])).deliveryFee).toBe(15);
  });
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
  it("builds independent backwards-compatible defaults", () => {
    const first = createDeliveryFilters(), second = createDeliveryFilters();
    first.metrics!.push({ key: "invoiceTotal", state: "known", min: null, max: null });
    expect(second.metrics).toEqual([]);
    expect(filterDeliveryRows(deliveryInvoiceView([row]), second)).toHaveLength(1);
    expect(DELIVERY_INVOICE_STATUS_LABELS.completed).toBe("Hoàn tất");
  });
  it.each(["assigned", "completed"])("uses inclusive Vietnam local-day bounds for %s timestamps", field => {
    const values = ["2026-10-31T16:59:59.999Z", "2026-10-31T17:00:00Z", "2026-11-01T16:59:59.999Z", "2026-11-01T17:00:00Z", null];
    const rows = deliveryInvoiceView(values.map((value, index) => ({ ...row, id: String(index), invoiceId: `invoice-${index}`, [field === "assigned" ? "assignedAt" : "completedAt"]: value })));
    const filters = { ...createDeliveryFilters(), [`${field}From`]: "2026-11-01", [`${field}To`]: "2026-11-01" };
    expect(filterDeliveryRows(rows, filters).map(r => r.id)).toEqual(["1", "2"]);
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), [`${field}From`]: "2026-11-01" }).map(r => r.id)).toEqual(["1", "2", "3"]);
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), [`${field}To`]: "2026-11-01" }).map(r => r.id)).toEqual(["0", "1", "2"]);
    expect(filterDeliveryRows(rows, createDeliveryFilters())).toHaveLength(5);
  });
  it.each([
    { assignedFrom: "2026-02-30" }, { completedTo: "11/01/2026" },
    { assignedFrom: "2026-11-02", assignedTo: "2026-11-01" },
    { completedFrom: "2026-11-02", completedTo: "2026-11-01" },
  ])("fails closed on invalid date filters %j", patch => {
    expect(filterDeliveryRows(deliveryInvoiceView([row]), { ...createDeliveryFilters(), ...patch })).toEqual([]);
  });
  it("combines branch, invoice status, tier, evidence, assignment, dates and metrics", () => {
    const selected = { ...row, assignedAt: "2026-11-01T00:00:00Z", completedAt: "2026-11-01T01:00:00Z", durationSeconds: 3600, deliveryFee: 10, deliveryTier: "near" };
    const rows = deliveryInvoiceView([selected, { ...selected, id: "other", branchId: "b", invoiceId: "other-invoice" }]);
    const filters: DeliveryFilters = { search: "nhan vien hoan tat tien mat", staff: "a:staff", status: "assigned", method: "cash",
      branch: "a", invoiceStatus: "completed", tier: "near", evidence: "linked", assignedState: "assigned",
      assignedFrom: "2026-11-01", assignedTo: "2026-11-01", completedFrom: "2026-11-01", completedTo: "2026-11-01",
      metrics: [{ key: "durationSeconds", state: "range", min: 3600, max: 3600 }, { key: "invoiceTotal", state: "range", min: 100, max: 100 }] };
    expect(filterDeliveryRows(rows, filters).map(r => r.id)).toEqual(["one"]);
    for (const patch of [{ branch: "c" }, { invoiceStatus: "draft" }, { tier: "far" }, { evidence: "missing" }, { assignedState: "unassigned" }]) {
      expect(filterDeliveryRows(rows, { ...filters, ...patch })).toEqual([]);
    }
  });
  it.each(["durationSeconds", "invoiceTotal", "invoicePaid", "invoiceDebt", "deliveryFee"])("keeps unknown %s distinct from genuine zero", key => {
    const rows = deliveryInvoiceView([
      { ...row, id: "unknown", invoiceId: "unknown", [key]: null },
      { ...row, id: "zero", invoiceId: "zero", [key]: 0 },
    ]);
    const filter = (state: "known" | "missing" | "range", min: number | null = null, max: number | null = null) => filterDeliveryRows(rows, { ...createDeliveryFilters(), metrics: [{ key, state, min, max }] }).map(r => r.id);
    expect(filter("missing")).toEqual(["unknown"]);
    expect(filter("known")).toEqual(["zero"]);
    expect(filter("range", 0, 0)).toEqual(["zero"]);
    expect(filter("range", 1, 0)).toEqual([]);
  });
  it.each(["staffId", "invoiceDuplicate", "unknown", "__proto__", "paid", "debt"])("rejects unsupported metric key %s even in missing mode", key => {
    expect(filterDeliveryRows(deliveryInvoiceView([row]), { ...createDeliveryFilters(), metrics: [{ key, state: "missing", min: null, max: null }] })).toEqual([]);
  });
  it("keeps duplicate evidence and excludes duplicate invoice money after filtering to one delivery", () => {
    const rows = deliveryInvoiceView([row, { ...row, id: "two", staffId: "other", branchId: "b" }]);
    const filtered = filterDeliveryRows(rows, { ...createDeliveryFilters(), branch: "a", staff: "a:staff", evidence: "duplicate", metrics: [{ key: "invoiceTotal", state: "known", min: null, max: null }] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].invoiceDuplicate).toBe(true);
    expect(summarizeDeliveryRows(filtered)).toMatchObject({ invoiceTotal: null, invoicePaid: null, invoiceDebt: null, missingInvoice: 1 });
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), evidence: "linked" })).toEqual([]);
  });
  it("identifies missing evidence and assignment from IDs, not amounts or timestamps", () => {
    const rows = deliveryInvoiceView([{ ...row, invoiceId: null, staffId: null, assignedAt: "2026-11-01T00:00:00Z" }, { ...row, id: "linked", assignedAt: null }]);
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), evidence: "missing", assignedState: "unassigned" }).map(r => r.id)).toEqual(["one"]);
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), evidence: "linked", assignedState: "assigned" }).map(r => r.id)).toEqual(["linked"]);
  });
  it("searches status, tier, payment and evidence labels accentlessly and by middle words", () => {
    const rows = deliveryInvoiceView([{ ...row, deliveryTier: "near" }]);
    for (const search of ["DH-1", "HD-1", "ang giao", "hoan tat", "tien mat", "hoa don phu hop"]) {
      expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), search })).toHaveLength(1);
    }
    const tier = rows[0].tierLabel;
    expect(filterDeliveryRows(rows, { ...createDeliveryFilters(), search: tier })).toHaveLength(1);
    const duplicates = deliveryInvoiceView([row, { ...row, id: "duplicate" }]);
    expect(filterDeliveryRows(duplicates, { ...createDeliveryFilters(), search: "gan nhieu don giao" })).toHaveLength(2);
    expect(filterDeliveryRows(deliveryInvoiceView([{ ...row, invoiceId: null }]), { ...createDeliveryFilters(), search: "chua co hoa don" })).toHaveLength(1);
  });
  it("retains sort values for every detail column, including real timestamps and numeric money", () => {
    const rows = deliveryInvoiceView([{ ...row, customerName: "Synthetic customer", assignedAt: "2026-11-01T01:00:00Z", completedAt: "2026-11-01T02:00:00Z", deliveryFee: 10, durationSeconds: 3600, deliveryTier: "near" }]);
    for (const column of deliveryManagementColumns(true)) {
      expect(deliverySortValue(rows[0], column.key)).not.toBeUndefined();
      expect(sortDeliveryRows(rows, { id: column.key, direction: "asc" })).toEqual(rows);
    }
    expect(deliverySortValue(rows[0], "assignedLabel")).toBe(Date.parse(rows[0].assignedAt!));
    expect(deliverySortValue(rows[0], "completedLabel")).toBe(Date.parse(rows[0].completedAt!));
    expect(deliverySortValue(rows[0], "invoiceTotal")).toBe(100);
  });
});
