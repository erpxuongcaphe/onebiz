import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { deliveryInvoiceView, deliveryManagementColumns } from "@/lib/reports/delivery-invoice-view";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import type { DeliveryInvoiceRow } from "@/lib/services/supabase/delivery-invoice-management";
const { save } = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs: save }));
describe("delivery invoice workbook", () => {
  it.each([true, false])("exports all permitted columns with numeric payments (%s)", async allowed => {
    vi.stubGlobal("Blob", NodeBlob);
    try {
      const columns = deliveryManagementColumns(allowed);
      const rows = deliveryInvoiceView([{ id: "test", branchId: "branch", branchName: "Quán thử", staffName: "Nhân viên thử", staffId: null, orderNumber: "DH-1", invoiceId: "invoice", invoiceCode: "HD-1", invoiceTotal: 100, invoicePaid: 60, invoiceDebt: 40, deliveryFee: 10, paymentMethod: "cash", invoiceStatus: "completed", deliveryStatus: "assigned", createdAt: "2026-11-01T01:00:00Z", assignedAt: null, completedAt: null, deliveryTier: null, durationSeconds: null } as DeliveryInvoiceRow]);
      const prepared = vi.fn();
      await exportReportToExcel({ kind: "fnb-shipper", mode: "full", branchName: "Quán thử", range: { from: "2026-11-01", to: "2026-11-01" }, sheets: [{ name: "Chi tiết", columns, rows }], onPrepared: prepared });
      const blob = save.mock.calls.at(-1)![0];
      expect(prepared).toHaveBeenCalledWith(blob, save.mock.calls.at(-1)![1]);
      const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Chi tiết"], { header: 1, defval: "" });
      expect(matrix[0]).toEqual(columns.map(c => c.label));
      expect(matrix[1]).toHaveLength(columns.length);
      if (allowed) expect(matrix[1][columns.findIndex(c => c.key === "invoicePaid")]).toBe(60);
      else expect(matrix[0].some(value => String(value).includes("VND"))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});
