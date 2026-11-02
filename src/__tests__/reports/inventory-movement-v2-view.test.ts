import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx-js-style";
import { exportReportToExcel } from "@/lib/utils/excel-export";
import type { InventoryMovementV2Report, InventoryMovementV2Row } from "@/lib/reports/inventory-movement-v2-contract";
import { filterInventoryMovementV2, inventoryMovementV2Columns, inventoryMovementV2Sheet, inventoryMovementV2Totals, inventoryMovementV2View, sortInventoryMovementV2 } from "@/lib/reports/inventory-movement-v2-view";

function row(overrides: Partial<InventoryMovementV2Row> = {}): InventoryMovementV2Row {
  return {
    branch_id: "branch-a", branch_name: "Chi nhánh thử", product_id: "product-a", code: "TEST-A", name: "Xưởng Cốt Dừa",
    catalog_unit: "G", unit_status: "current_catalog", product_type: null, inventory_role: null,
    current_qty: "3", reserved_qty: "1", available_qty: "2", movement_net: "3", movement_difference: "0",
    movement_count: 1, quantity_event_count: 1, zero_audit_count: 0, unsupported_count: 0, future_count: 0, ambiguous_order_count: 0,
    last_receipt_at: "2026-01-31T00:00:00Z", last_stock_out_at: null, last_recorded_usage_at: null, last_direct_sale_out_at: null,
    age_status: "unverified", age_buckets: null, age_reason: "coverage_not_certified", review_status: "recent_movement", ...overrides,
  };
}
function report(rows: InventoryMovementV2Row[], costVisible = false): InventoryMovementV2Report {
  return { version: 2, generated_at: "2026-02-01T00:00:00Z", tenant_id: "tenant", branch_id: null,
    cost_visible: costVisible, stock_basis: "branch_stock_net_by_branch_product", age_basis: "not_yet_certified", row_count: rows.length, rows,
    summary: { branch_product_count: rows.length, distinct_products: rows.length, negative_stock_count: 0, history_reconcile_count: 0, unverified_age_count: rows.length } };
}
const noFilters = { search: "", branch: "", unit: "", review: "", valuation: "" };
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));

describe("inventory V2 build-only view and export", () => {
  it("keeps decimal strings and distinguishes unloaded from absent conversions", () => {
    const data = report([row({ current_qty: "2.1234" })]);
    expect(inventoryMovementV2View(data)[0].conversionLabel).toBe("Chưa tải quy đổi");
    expect(inventoryMovementV2View(data, new Map())[0].conversionLabel).toBe("Không có quy đổi phụ");
    const view = inventoryMovementV2View(data, new Map([["product-a", "1 Cây = 50 Cái"]]));
    expect(view[0].conversionLabel).toBe("1 Cây = 50 Cái");
    expect(view[0].current_qty).toBe("2.1234");
    expect(view[0].ageLabel).toBe("Chưa đủ căn cứ");
  });
  it("searches accented and middle words while combining dimension filters", () => {
    const rows = inventoryMovementV2View(report([row(), row({ product_id: "b", branch_id: "branch-b", catalog_unit: "Cái" })]));
    for (const search of ["cốt dừa", "cot dua"]) {
      expect(filterInventoryMovementV2(rows, { ...noFilters, search, branch: "branch-a", unit: "G" })).toHaveLength(1);
    }
    expect(filterInventoryMovementV2(rows, { ...noFilters, review: "negative_stock" })).toEqual([]);
  });
  it("sorts precise decimals, not lexicographically or via Number", () => {
    const rows = inventoryMovementV2View(report([row({ current_qty: "10.2" }), row({ product_id: "b", current_qty: "10.12" }), row({ product_id: "c", current_qty: "10.120000000000000001" })]));
    expect(sortInventoryMovementV2(rows, { id: "current_qty", direction: "asc" }).map(r => r.product_id)).toEqual(["b", "c", "product-a"]);
    expect(sortInventoryMovementV2(rows, { id: "current_qty", direction: "desc" }).map(r => r.product_id)).toEqual(["product-a", "c", "b"]);
  });
  it("sorts display date columns by source time and keeps missing dates last", () => {
    const rows = inventoryMovementV2View(report([row(), row({ product_id: "b", last_receipt_at: "2026-02-01T00:00:00Z" }), row({ product_id: "c", last_receipt_at: null })]));
    expect(sortInventoryMovementV2(rows, { id: "receiptLabel", direction: "asc" }).map(r => r.product_id)).toEqual(["product-a", "b", "c"]);
    expect(sortInventoryMovementV2(rows, { id: "receiptLabel", direction: "desc" }).map(r => r.product_id)).toEqual(["b", "product-a", "c"]);
  });
  it("does not combine reference values with the canonical ledger or multiply rounded prices", () => {
    const rows = inventoryMovementV2View(report([
      row({ valuation: { basis: "branch_cost_ledger", source_complete: true, status: "supported", value: "10.0000", unit_cost: "3.3333" } }),
      row({ product_id: "b", valuation: { basis: "catalog_reference", source_complete: false, status: "reference_only", value: "20.1234", unit_cost: "6.7078" } }),
      row({ product_id: "c", valuation: { basis: "branch_cost_ledger", source_complete: false, status: "incomplete", value: null, unit_cost: null } }),
    ], true));
    expect(inventoryMovementV2Totals(rows)).toMatchObject({ ledgerSubtotal: "10", referenceSubtotal: "20.1234", ledgerTotal: null, incomplete: 1, references: 1 });
    expect(inventoryMovementV2Totals(rows.slice(0, 1)).ledgerTotal).toBe("10");
  });
  it("exports all required unit/quantity/history fields but no monetary columns without permission", () => {
    const keys = inventoryMovementV2Columns(false).map(c => c.key);
    expect(keys).toEqual(expect.arrayContaining(["unitLabel", "conversionLabel", "current_qty", "reserved_qty", "available_qty", "movement_difference", "ageReason"]));
    expect(keys).not.toEqual(expect.arrayContaining(["stockValue"]));
    expect(inventoryMovementV2Columns(true)).toHaveLength(keys.length + 3);
    const sheet = inventoryMovementV2Sheet(inventoryMovementV2View(report([row()])), false);
    expect(sheet.footer).not.toHaveProperty("current_qty");
    expect(sheet.footer).not.toHaveProperty("stockValue");
    expect(sheet.footer?.unitLabel).toBe("Không cộng khác ĐVT");
  });
  it("retains negative and reserved-only items in filtered totals", () => {
    const rows = inventoryMovementV2View(report([row({ current_qty: "-2", review_status: "negative_stock" }), row({ product_id: "b", current_qty: "0", reserved_qty: "1", review_status: "reserved_without_stock" })]));
    expect(inventoryMovementV2Totals(rows)).toMatchObject({ count: 2, negative: 1 });
    expect(filterInventoryMovementV2(rows, { ...noFilters, review: "reserved_without_stock" })).toHaveLength(1);
  });
  it.each([false, true])("reads actual XLSX cells back with cost permission %s", async costVisible => {
    const rows = inventoryMovementV2View(report([row({ current_qty: "3.1234", valuation: costVisible ? { basis: "branch_cost_ledger", source_complete: true, status: "supported", value: "10.0000", unit_cost: "3.2016" } : undefined })], costVisible), new Map([["product-a", "1 Cây = 50 Cái"]]));
    let blob: Blob | undefined;
    await exportReportToExcel({ kind: "aging", mode: "full", range: { from: "2026-02-01", to: "2026-02-01" }, sheets: [inventoryMovementV2Sheet(rows, costVisible)], onPrepared: file => { blob = file; } });
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob!); });
    const book = XLSX.read(bytes, { type: "array" });
    const sheet = book.Sheets["Chi tiết tồn kho"];
    const cells = Object.entries(sheet).filter(([key]) => !key.startsWith("!")).map(([, value]) => value as XLSX.CellObject);
    expect(cells.some(cell => cell.t === "n" && cell.v === 3.1234)).toBe(true);
    expect(cells.some(cell => cell.v === "1 Cây = 50 Cái")).toBe(true);
    expect(cells.some(cell => cell.v === "Tuổi lớp hàng")).toBe(true);
    expect(cells.some(cell => cell.v === "Đơn giá theo nguồn")).toBe(costVisible);
    expect(cells.some(cell => cell.v === "Giá trị theo nguồn")).toBe(costVisible);
    if (costVisible) expect(cells.some(cell => cell.t === "n" && cell.v === 10)).toBe(true);
  });
});
