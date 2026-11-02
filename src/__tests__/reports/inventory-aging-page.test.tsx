import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseInventoryMovementV2, type InventoryMovementV2Report, type InventoryMovementV2Row } from "@/lib/reports/inventory-movement-v2-contract";
import type { ExportOptions } from "@/lib/utils/excel-export";

const state = vi.hoisted(() => ({ read: vi.fn(), excel: vi.fn(), units: vi.fn(),
  branch: "00000000-0000-4000-8000-000000000002", allowed: true, costAllowed: true,
  exportView: true, exportFull: true }));
const tenantId = "00000000-0000-4000-8000-000000000001";
const otherBranch = "00000000-0000-4000-8000-000000000003";
vi.mock("@/lib/contexts", () => ({
  useAuth: () => {
    const permissions = new Set<string>([
      ...(state.allowed ? ["reports.analytics", "reports.view_detail"] : []),
      ...(state.costAllowed ? ["products.view_cost"] : []),
      ...(state.exportView ? ["reports.export"] : []), ...(state.exportFull ? ["reports.export_detail"] : []),
    ]);
    return { tenant: { id: "00000000-0000-4000-8000-000000000001" }, user: { id: "synthetic-user" }, permissions,
      isLoading: false, hasPermission: (key: string) => permissions.has(key) };
  },
  useBranchFilter: () => ({ activeBranchId: state.branch, isReady: true }),
}));
vi.mock("@/lib/services/supabase/inventory-movement-v2", () => ({ getInventoryMovementV2Report: state.read }));
vi.mock("@/lib/services/supabase/report-stock-units", () => ({
  getStockReportUnits: state.units, stockUnitReferenceKey: (reference: string, product: string) => `${reference}:${product}`,
}));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: state.excel }));
import Page from "@/app/(main)/phan-tich/aging/page";

function snapshot(branchId = state.branch, empty = false): InventoryMovementV2Report {
  const first: InventoryMovementV2Row = {
    branch_id: branchId, branch_name: "Chi nhánh thử", product_id: "00000000-0000-4000-8000-000000000004",
    code: "SKU-1", name: "Xưởng Cốt Dừa", catalog_unit: "Cái", unit_status: "current_catalog",
    product_type: null, inventory_role: null, current_qty: "50", reserved_qty: "0", available_qty: "50",
    movement_net: "50", movement_difference: "0", movement_count: 0, quantity_event_count: 0, zero_audit_count: 0,
    unsupported_count: 0, future_count: 0, ambiguous_order_count: 0,
    last_receipt_at: null, last_stock_out_at: null, last_recorded_usage_at: null, last_direct_sale_out_at: null,
    age_status: "unverified", age_buckets: null, age_reason: "no_history", review_status: "insufficient_history",
    ...(state.costAllowed ? { valuation: { basis: "branch_cost_ledger" as const, source_complete: true,
      status: "supported" as const, value: "500", unit_cost: "10" } } : {}),
  };
  const second: InventoryMovementV2Row = { ...first, product_id: "00000000-0000-4000-8000-000000000005",
    code: "SKU-2", name: "Ly giấy", current_qty: "10", available_qty: "10", movement_net: "10",
    ...(state.costAllowed ? { valuation: { basis: "branch_cost_ledger", source_complete: false,
      status: "incomplete", value: null, unit_cost: null } } : {}),
  };
  return parseInventoryMovementV2({ version: 2, generated_at: "2026-10-28T18:00:00Z", tenant_id: tenantId,
    branch_id: branchId, cost_visible: state.costAllowed, stock_basis: "branch_stock_net_by_branch_product",
    age_basis: "not_yet_certified", row_count: empty ? 0 : 2, rows: empty ? [] : [first, second],
    summary: { branch_product_count: empty ? 0 : 2, distinct_products: empty ? 0 : 2,
      negative_stock_count: 0, history_reconcile_count: 0, unverified_age_count: empty ? 0 : 2,
      ...(state.costAllowed ? { valuation: { ledger_complete: empty, ledger_value: empty ? "0" : null,
        known_ledger_subtotal: empty ? "0" : "500", reference_subtotal: "0", incomplete_count: empty ? 0 : 1, reference_count: 0 } } : {}),
    } }, { tenantId, branchId });
}
const detailCodes = () => Array.from(document.querySelector<HTMLTableElement>("table")!.tBodies[0].rows).map(row => row.cells[1]?.textContent);
const options = () => state.excel.mock.calls.at(-1)![0] as ExportOptions;

beforeEach(() => {
  vi.clearAllMocks(); window.history.replaceState({}, "", "/phan-tich/aging?view=table");
  state.branch = "00000000-0000-4000-8000-000000000002";
  state.allowed = true; state.costAllowed = true; state.exportView = true; state.exportFull = true;
  state.read.mockReset().mockImplementation(async () => snapshot());
  state.excel.mockReset().mockResolvedValue(undefined);
  state.units.mockReset().mockImplementation(async (lines: { productId: string }[]) => new Map(lines.map(line => [
    `${line.productId}:${line.productId}`, { catalogUnit: "Cái", currentConversion: "1 Cây = 50 Cái" },
  ])));
});
afterEach(cleanup);

it("exports filtered V2 detail and review counts without inventing age or a mixed quantity total", async () => {
  render(<Page />); await screen.findByText("SKU-1");
  expect(screen.getByText("Tổng giá trị sổ kho").parentElement).toHaveTextContent("Chưa đủ căn cứ");
  expect(screen.getByText("Thời điểm: 29/10/2026 01:00 (VN, UTC+07:00)")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm mã, mặt hàng" }), { target: { value: "cot dua" } });
  expect(detailCodes()).toEqual(["SKU-1"]);
  expect(screen.getByText("Tổng giá trị sổ kho").parentElement).toHaveTextContent("500 VND");
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
  await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
  const exported = options();
  expect(exported.range).toEqual({ from: "2026-10-29", to: "2026-10-29" });
  expect(exported.mode).toBe("full");
  const [detail, groups] = exported.sheets;
  expect(detail.rows).toHaveLength(1);
  expect(detail.rows[0]).toMatchObject({ code: "SKU-1", stockValue: "500", unitCost: "10",
    ageLabel: "Chưa đủ căn cứ", ageReason: "Thiếu lịch sử kho", reviewLabel: "Thiếu lịch sử", conversionLabel: "1 Cây = 50 Cái",
    receiptLabel: "", outflowLabel: "", usageLabel: "", saleLabel: "" });
  for (const key of ["daysInStock", "agingBucket"]) expect(detail.columns.map(column => column.key)).not.toContain(key);
  expect(detail.footer).not.toHaveProperty("current_qty");
  expect(groups.footer).toMatchObject({ count: 1 });
  expect(groups.rows.find(row => row.label === "Thiếu lịch sử")?.count).toBe(1);
  expect(groups.rows.reduce((sum, row) => sum + Number(row.count), 0)).toBe(1);
  for (const sheet of exported.sheets) expect(sheet.titleRows?.join(" ")).toContain("Tuổi lớp hàng chưa được xác nhận");
});

it("ignores a late old-branch response and does not enrich its units", async () => {
  let finish!: (value: InventoryMovementV2Report) => void;
  const old = snapshot(); state.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<Page />); const signal = state.read.mock.calls[0][0].signal as AbortSignal;
  state.branch = otherBranch; state.read.mockResolvedValue(snapshot(otherBranch, true)); view.rerender(<Page />);
  await screen.findByText("Không có mặt hàng khớp bộ lọc.");
  expect(signal.aborted).toBe(true);
  await act(async () => finish(old));
  expect(screen.queryByText("SKU-1")).not.toBeInTheDocument();
  expect(state.units).toHaveBeenCalledTimes(1); expect(state.units).toHaveBeenCalledWith([], "current_stock");
});

it("permits quantity-only reports but omits monetary UI and every monetary export field", async () => {
  state.costAllowed = false; render(<Page />); await screen.findByText("SKU-1");
  expect(state.read).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Cơ sở giá trị")).not.toBeInTheDocument();
  expect(screen.queryByText("Tổng giá trị sổ kho")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Đơn giá theo nguồn" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
  await waitFor(() => expect(state.excel).toHaveBeenCalledOnce());
  for (const sheet of options().sheets) {
    for (const key of ["unitCost", "stockValue", "valueLabel"]) expect(sheet.columns.map(column => column.key)).not.toContain(key);
    expect(JSON.stringify(sheet.rows)).not.toMatch(/valuation|unitCost|stockValue|valueLabel/);
  }
});

it("hides cached quantities, costs and export actions when report permission is revoked", async () => {
  const view = render(<Page />); await screen.findByText("SKU-1");
  const signal = state.read.mock.calls[0][0].signal as AbortSignal;
  state.allowed = false; view.rerender(<Page />);
  expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền");
  expect(screen.queryByRole("table")).not.toBeInTheDocument(); expect(screen.queryByText("500 VND")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Excel đầy đủ" })).not.toBeInTheDocument();
  expect(signal.aborted).toBe(true); expect(state.read).toHaveBeenCalledOnce();
});

it("shows an explicit safe source error, disables exports and supports retry", async () => {
  state.read.mockRejectedValueOnce(new Error("private backend detail")); render(<Page />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được dữ liệu tồn kho");
  expect(screen.queryByText("private backend detail")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tải lại" })); await screen.findByText("SKU-1");
  expect(state.read).toHaveBeenCalledTimes(2);
});

it("cancels a pending export after filters change and suppresses obsolete download errors", async () => {
  let reject!: (reason: Error) => void;
  state.excel.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<Page />); await screen.findByText("SKU-1");
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
  const canSave = options().shouldSave!; expect(canSave()).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Tìm mã, mặt hàng" }), { target: { value: "khac" } });
  expect(canSave()).toBe(false);
  await act(async () => reject(new Error("Download failed")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(state.excel).toHaveBeenCalledOnce();
});

it("shows a current export failure and allows another explicit attempt", async () => {
  state.excel.mockRejectedValueOnce(new Error("Download failed")); render(<Page />); await screen.findByText("SKU-1");
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tạo được file");
  fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
  await waitFor(() => expect(state.excel).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each([{ view: false, full: false }, { view: true, full: false }, { view: false, full: true }])("honors separate export permissions $view/$full", async ({ view, full }) => {
  state.exportView = view; state.exportFull = full; render(<Page />); await screen.findByText("SKU-1");
  expect(!!screen.queryByRole("button", { name: "Excel hiện tại" })).toBe(view);
  expect(!!screen.queryByRole("button", { name: "Excel đầy đủ" })).toBe(full);
  if (view || full) {
    fireEvent.click(screen.getByRole("button", { name: full ? "Excel đầy đủ" : "Excel hiện tại" }));
    await waitFor(() => expect(state.excel).toHaveBeenCalledOnce()); expect(options().mode).toBe(full ? "full" : "view");
  } else expect(state.excel).not.toHaveBeenCalled();
});
