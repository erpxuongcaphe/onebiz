import { describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import * as XLSX from "xlsx";
import { DELIVERY_DETAIL_COLUMNS, deliveryDateTime, deliveryDetailRow } from "@/lib/reports/delivery-report-export";
import type { ShipperOrderRow } from "@/lib/services/supabase/fnb-analytics";
import { exportReportToExcel } from "@/lib/utils/excel-export";
const { saveAs } = vi.hoisted(() => ({ saveAs: vi.fn() }));
vi.mock("file-saver", () => ({ saveAs }));

const order: ShipperOrderRow = {
  kitchenOrderId: "order-1", orderNumber: "DH-001", invoiceId: "invoice-1",
  invoiceCode: "HD-001", customerName: "Khách thử", total: 125000, deliveryFee: 15000,
  deliveryTier: "near", createdAt: "2026-10-31T17:30:00Z", assignedAt: "2026-10-31T17:40:00Z",
  completedAt: "2026-10-31T17:50:00Z", durationSeconds: 600,
};

describe("delivery report detail export", () => {
  it("exports every detail field with explicit money/time units", () => {
    const row = deliveryDetailRow("Nhân viên thử", order);
    expect(DELIVERY_DETAIL_COLUMNS.map(c => c.key)).toEqual(Object.keys(row));
    expect(row).toMatchObject({ total: 125000, deliveryFee: 15000, tier: "Gần", duration: 600, status: "Đã giao" });
    expect(DELIVERY_DETAIL_COLUMNS.find(c => c.key === "total")?.label).toContain("VND");
    expect(DELIVERY_DETAIL_COLUMNS.find(c => c.key === "duration")?.label).toContain("giây");
  });

  it("retains numeric zero but does not invent an invoice or delivery time", () => {
    const row = deliveryDetailRow("NV", { ...order, invoiceId: null, invoiceCode: null, total: 0, deliveryFee: 0, assignedAt: null, completedAt: null, durationSeconds: null });
    expect(row).toMatchObject({ total: "", deliveryFee: 0, invoiceCode: "", assignedAt: "", completedAt: "", duration: "", status: "Chưa ghi nhận nhận giao" });
    expect(deliveryDetailRow("NV", { ...order, total: 0 }).total).toBe(0);
    expect(deliveryDetailRow("NV", { ...order, completedAt: null }).status).toBe("Đang giao");
  });

  it("formats the same Vietnam time regardless of the machine timezone", () => {
    expect(deliveryDateTime(order.createdAt)).toContain("1/11/2026");
    expect(deliveryDateTime(order.createdAt)).toContain("00:30:00");
    expect(deliveryDateTime(null)).toBe("");
    expect(deliveryDateTime("invalid")).toBe("");
  });

  it("round-trips all exported columns, amounts and missing values through XLSX", () => {
    const rows = [deliveryDetailRow("NV", order), deliveryDetailRow("NV", { ...order, invoiceId: null, assignedAt: null, completedAt: null, durationSeconds: null })];
    const matrix = [DELIVERY_DETAIL_COLUMNS.map(c => c.label), ...rows.map(row => DELIVERY_DETAIL_COLUMNS.map(c => row[c.key as keyof typeof row]))];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(matrix), "Chi tiết đơn giao");
    const result = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
    expect(XLSX.utils.sheet_to_json(result.Sheets["Chi tiết đơn giao"], { header: 1, defval: "" })).toEqual(matrix);
  });
  it("generates a real full report workbook with all detail columns and scope metadata", async () => {
    vi.stubGlobal("Blob", NodeBlob);
    try {
      await exportReportToExcel({ kind: "fnb-shipper", mode: "full", branchName: "Chi nhánh thử", range: { from: "2026-11-01", to: "2026-11-01" }, sheets: [{ name: "Chi tiết đơn giao", columns: DELIVERY_DETAIL_COLUMNS, rows: [deliveryDetailRow("NV", order)] }] });
      const [blob, filename] = saveAs.mock.calls.at(-1)!;
      const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Chi tiết đơn giao"], { header: 1, defval: "" });
      expect(rows).toContainEqual(DELIVERY_DETAIL_COLUMNS.map(c => c.label));
      expect(rows).toContainEqual(["NV", "DH-001", "HD-001", "Khách thử", 125000, 15000, "Gần", deliveryDateTime(order.createdAt), deliveryDateTime(order.assignedAt), deliveryDateTime(order.completedAt), 600, "Đã giao"]);
      expect(book.SheetNames.length).toBeGreaterThan(1);
      expect(filename).toContain("fnb-shipper");
    } finally { vi.unstubAllGlobals(); }
  });
});
