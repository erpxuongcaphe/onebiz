import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryMovementV2Report, InventoryMovementV2Row } from "@/lib/reports/inventory-movement-v2-contract";
import { parseInventoryMovementV2 } from "@/lib/reports/inventory-movement-v2-contract";
import type { ExportOptions } from "@/lib/utils/excel-export";
const mocks = vi.hoisted(() => ({ export: vi.fn() }));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel: mocks.export }));
import InventoryMovementV2ReportComponent from "@/components/shared/report/inventory-movement-v2-report";

const tenant = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-000000000002";
const otherBranch = "00000000-0000-4000-8000-000000000003";
function fixture(cost = false): InventoryMovementV2Report {
  const row: InventoryMovementV2Row = {
    branch_id: branch, branch_name: "Chi nhánh A", product_id: "00000000-0000-4000-8000-000000000004",
    code: "TEST-A", name: "Hàng thử A", catalog_unit: "G", unit_status: "current_catalog",
    product_type: null, inventory_role: null, current_qty: "2.000000000000000001", reserved_qty: "0",
    available_qty: "2.000000000000000001", movement_net: "2.000000000000000001", movement_difference: "0",
    movement_count: 1, quantity_event_count: 1, zero_audit_count: 0, unsupported_count: 0,
    future_count: 0, ambiguous_order_count: 0, last_receipt_at: "2026-11-01T00:00:00Z",
    last_stock_out_at: null, last_recorded_usage_at: null, last_direct_sale_out_at: null,
    age_status: "unverified", age_buckets: null, age_reason: "coverage_not_certified", review_status: "recent_movement",
    ...(cost ? { valuation: { basis: "branch_cost_ledger" as const, source_complete: true, status: "supported" as const, value: "8", unit_cost: "4" } } : {}),
  };
  const second: InventoryMovementV2Row = { ...row, branch_id: otherBranch, branch_name: "Chi nhánh B",
    product_id: "00000000-0000-4000-8000-000000000005", code: "TEST-B", name: "Hàng thử B", catalog_unit: "Lon",
    current_qty: "2.000000000000000002", available_qty: "2.000000000000000002", movement_net: "2.000000000000000002",
    ...(cost ? { valuation: { basis: "catalog_reference", source_complete: true, status: "reference_only", value: "12", unit_cost: "6" } } : {}),
  };
  return parseInventoryMovementV2({ version: 2, generated_at: "2026-11-02T00:00:00Z", tenant_id: tenant,
    branch_id: null, cost_visible: cost, stock_basis: "branch_stock_net_by_branch_product", age_basis: "not_yet_certified",
    row_count: 2, rows: [second, row], summary: { branch_product_count: 2, distinct_products: 2, negative_stock_count: 0,
      history_reconcile_count: 0, unverified_age_count: 2,
      ...(cost ? { valuation: { ledger_complete: false, ledger_value: null, known_ledger_subtotal: "8", reference_subtotal: "12", incomplete_count: 0, reference_count: 1 } } : {}) } },
  { tenantId: tenant, branchId: null });
}
// Native table collections avoid accessibility-tree walks over thousands of cells.
const tableCodes = () => Array.from(document.querySelector<HTMLTableElement>("table")!.tBodies[0].rows)
  .map(row => row.cells[1].textContent);
const pagination = () => within(screen.getByLabelText("Phân trang tồn kho"));
const columnButton = (name: string) => within(document.querySelector("thead")!).getByRole("button", { name });
function largeFixture(): InventoryMovementV2Report {
  const data = fixture();
  data.rows = Array.from({ length: 121 }, (_, index) => ({ ...data.rows[index % 2],
    product_id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, "0")}`,
    code: `TEST-${String(index + 1).padStart(3, "0")}`, name: `Hàng thử ${index + 1}`,
    current_qty: String(index + 1), available_qty: String(index + 1), movement_net: String(index + 1),
  }));
  data.row_count = 121;
  Object.assign(data.summary, { branch_product_count: 121, distinct_products: 121, unverified_age_count: 121 });
  return parseInventoryMovementV2(data, { tenantId: tenant, branchId: null });
}

describe("inventory movement V2 build-only component", () => {
  beforeEach(() => {
    mocks.export.mockReset().mockImplementation(async (options: ExportOptions) => { options.onPrepared?.(new Blob(["synthetic"]), "synthetic.xlsx"); });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:synthetic");
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("omits all cost controls and columns for quantity-only snapshots; export defaults off", () => {
    render(<InventoryMovementV2ReportComponent report={fixture()} />);
    expect(screen.queryByText("Đơn giá theo nguồn")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cơ sở giá trị")).not.toBeInTheDocument();
    expect(screen.queryByText("Phần sổ kho xác định")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel đầy đủ" })).not.toBeInTheDocument();
    expect(screen.getByText("Không cộng số lượng khác ĐVT.")).toBeInTheDocument();
    expect(screen.getAllByText("Chưa đủ căn cứ")).toHaveLength(2);
  });
  it("separates ledger and reference values without certifying their combined total", () => {
    render(<InventoryMovementV2ReportComponent report={fixture(true)} />);
    expect(screen.getByLabelText("Cơ sở giá trị")).toBeInTheDocument();
    expect(screen.getByText("8 VND")).toBeInTheDocument();
    expect(screen.getByText("12 VND")).toBeInTheDocument();
    expect(screen.queryByText("20 VND")).not.toBeInTheDocument();
    expect(screen.getByText("Tổng giá trị sổ kho").parentElement).toHaveTextContent("Chưa đủ căn cứ");
  });
  it("filters branch, unit, review, valuation and accent-insensitive search", () => {
    render(<InventoryMovementV2ReportComponent report={fixture(true)} />);
    fireEvent.change(screen.getByLabelText("Chi nhánh"), { target: { value: branch } });
    fireEvent.change(screen.getByLabelText("Đơn vị"), { target: { value: "G" } });
    fireEvent.change(screen.getByLabelText("Cần kiểm tra"), { target: { value: "recent_movement" } });
    fireEvent.change(screen.getByLabelText("Cơ sở giá trị"), { target: { value: "supported" } });
    fireEvent.change(screen.getByLabelText("Tìm mã, mặt hàng"), { target: { value: "hang thu" } });
    expect(tableCodes()).toEqual(["TEST-A"]);
    fireEvent.change(screen.getByLabelText("Đơn vị"), { target: { value: "Lon" } });
    expect(screen.getByText("Không có mặt hàng khớp bộ lọc.")).toBeInTheDocument();
  });
  it("uses exact Decimal order for both table and View/Full exported records", async () => {
    render(<InventoryMovementV2ReportComponent report={fixture()} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Tồn hiện tại" }));
    expect(tableCodes()).toEqual(["TEST-A", "TEST-B"]);
    fireEvent.click(screen.getByRole("button", { name: "Tồn hiện tại" }));
    expect(tableCodes()).toEqual(["TEST-B", "TEST-A"]);
    for (const name of ["Excel hiện tại", "Excel đầy đủ"]) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name })));
      const options = mocks.export.mock.calls.at(-1)![0] as ExportOptions;
      expect(options.sheets[0].rows.map(row => row.code)).toEqual(["TEST-B", "TEST-A"]);
      expect(options.sheets[0].rows[0].current_qty).toBe("2.000000000000000002");
      expect(options.sheets[0].titleRows?.join(" ")).toContain("Thời điểm: 02/11/2026 07:00 (VN, UTC+07:00)");
      expect(options.description).toContain("2026-11-02T00:00:00Z");
      expect(options.sheets[0].titleRows?.join(" ")).toContain("Tuổi lớp hàng chưa được xác nhận");
      expect(JSON.stringify(options.sheets[0].rows)).not.toMatch(/valuation|unitCost|stockValue/);
      expect(options.sheets[0].footer).not.toHaveProperty("current_qty");
    }
    expect(screen.getByRole("link", { name: /Tải file Excel/ })).toHaveAttribute("download", "synthetic.xlsx");
  });
  it("invalidates pending exports and prepared links when filters or snapshot/options change", async () => {
    let captured!: ExportOptions;
    let finish!: () => void;
    mocks.export.mockImplementation((options: ExportOptions) => { captured = options; return new Promise<void>(resolve => { finish = resolve; }); });
    const report = fixture();
    const view = render(<InventoryMovementV2ReportComponent report={report} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
    expect(captured.shouldSave?.()).toBe(true);
    fireEvent.change(screen.getByLabelText("Đơn vị"), { target: { value: "G" } });
    expect(captured.shouldSave?.()).toBe(false);
    await act(async () => { captured.onPrepared?.(new Blob(["stale"]), "stale.xlsx"); finish(); });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    mocks.export.mockImplementation(async (options: ExportOptions) => options.onPrepared?.(new Blob(["ok"]), "ok.xlsx"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" })));
    expect(screen.getByRole("link")).toBeInTheDocument();
    view.rerender(<InventoryMovementV2ReportComponent report={report} conversions={new Map([[report.rows[0].product_id, "1 thùng = 24 lon"]])} canExport />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Đơn vị")).toHaveValue("");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("hides data during loading/error and exposes only an explicit reload callback", () => {
    const reload = vi.fn();
    const report = fixture(true);
    const view = render(<InventoryMovementV2ReportComponent report={report} loading onReload={reload} canExport />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeDisabled();
    view.rerender(<InventoryMovementV2ReportComponent report={report} error="Không tải được snapshot" onReload={reload} canExport />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được snapshot");
    expect(screen.getByRole("button", { name: "Excel đầy đủ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it("invalidates a delayed file after snapshot replacement and permission withdrawal", async () => {
    const pending: { options: ExportOptions; finish: () => void }[] = [];
    mocks.export.mockImplementation((options: ExportOptions) => new Promise<void>(finish => pending.push({ options, finish })));
    const original = fixture();
    const view = render(<InventoryMovementV2ReportComponent report={original} canExport />);
    fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
    const next = { ...original, generated_at: "2026-11-02T01:00:00Z" };
    view.rerender(<InventoryMovementV2ReportComponent report={next} canExport />);
    expect(pending[0].options.shouldSave?.()).toBe(false);
    await act(async () => { pending[0].options.onPrepared?.(new Blob(["old"]), "old.xlsx"); pending[0].finish(); });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Excel đầy đủ" }));
    view.rerender(<InventoryMovementV2ReportComponent report={next} canExport={false} />);
    expect(pending[1].options.shouldSave?.()).toBe(false);
    await act(async () => { pending[1].options.onPrepared?.(new Blob(["old"]), "old.xlsx"); pending[1].finish(); });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel đầy đủ" })).not.toBeInTheDocument();
  });
  it("paginates locally while both exports retain all filtered globally sorted records", async () => {
    render(<InventoryMovementV2ReportComponent report={largeFixture()} canExport />);
    const pager = pagination();
    const next = pager.getByRole("button", { name: "Trang sau" });
    const sortQuantity = columnButton("Tồn hiện tại");
    const exportView = screen.getByRole("button", { name: "Excel hiện tại" });
    const exportFull = screen.getByRole("button", { name: "Excel đầy đủ" });
    expect(tableCodes()).toHaveLength(50);
    expect(screen.getByText("121 dòng · 121 mặt hàng")).toBeInTheDocument();
    expect(screen.getByText("1–50 / 121 dòng")).toBeInTheDocument();
    expect(pager.getByRole("button", { name: "Trang trước" })).toBeDisabled();
    fireEvent.click(sortQuantity);
    fireEvent.click(sortQuantity);
    fireEvent.click(next);
    expect(tableCodes()[0]).toBe("TEST-071");
    expect(screen.getByText("51–100 / 121 dòng")).toBeInTheDocument();
    for (const button of [exportView, exportFull]) {
      await act(async () => fireEvent.click(button));
      const options = mocks.export.mock.calls.at(-1)![0] as ExportOptions;
      expect(options.sheets[0].rows).toHaveLength(121);
      expect(options.sheets[0].rows[0].code).toBe("TEST-121");
      expect(options.sheets[0].rows.at(-1)?.code).toBe("TEST-001");
      expect(options.sheets[0].footer?.name).toContain("121");
      expect(options.sheets[0].titleRows?.join(" ")).toContain("Thời điểm:");
    }
    fireEvent.change(screen.getByLabelText("Chi nhánh"), { target: { value: otherBranch } });
    expect(tableCodes()).toHaveLength(50);
    expect(screen.getByText("1–50 / 61 dòng")).toBeInTheDocument();
    expect(screen.getByText("61 dòng · 61 mặt hàng")).toBeInTheDocument();
    fireEvent.click(next);
    expect(tableCodes()).toHaveLength(11);
    await act(async () => fireEvent.click(exportFull));
    const exported = (mocks.export.mock.calls.at(-1)![0] as ExportOptions).sheets[0];
    expect(exported.rows).toHaveLength(61);
    expect(exported.rows.every(row => row.branch_name === "Chi nhánh B")).toBe(true);
  });
  it("supports 50/100/200 sizes and resets to the first page when size changes", () => {
    render(<InventoryMovementV2ReportComponent report={largeFixture()} />);
    const next = pagination().getByRole("button", { name: "Trang sau" });
    const size = screen.getByLabelText("Dòng mỗi trang");
    expect(tableCodes()).toHaveLength(50);
    fireEvent.click(next);
    expect(screen.getByText("51–100 / 121 dòng")).toBeInTheDocument();
    fireEvent.change(size, { target: { value: "100" } });
    expect(tableCodes()).toHaveLength(100);
    expect(screen.getByText("1–100 / 121 dòng")).toBeInTheDocument();
    fireEvent.click(next);
    expect(tableCodes()).toHaveLength(21);
    fireEvent.change(size, { target: { value: "200" } });
    expect(tableCodes()).toHaveLength(121);
    expect(screen.getByText("1–121 / 121 dòng")).toBeInTheDocument();
    expect(next).toBeDisabled();
    fireEvent.change(size, { target: { value: "50" } });
    expect(tableCodes()).toHaveLength(50);
    expect(screen.getByText("1–50 / 121 dòng")).toBeInTheDocument();
  });
  it("resets pagination after global sorting and filtering", () => {
    render(<InventoryMovementV2ReportComponent report={largeFixture()} />);
    const next = pagination().getByRole("button", { name: "Trang sau" });
    const sortCode = columnButton("Mã hàng");
    const search = screen.getByLabelText("Tìm mã, mặt hàng");
    fireEvent.click(next);
    expect(screen.getByText("51–100 / 121 dòng")).toBeInTheDocument();
    fireEvent.click(sortCode);
    expect(screen.getByText("1–50 / 121 dòng")).toBeInTheDocument();
    expect(tableCodes()[0]).toBe("TEST-001");
    fireEvent.click(next);
    expect(tableCodes()[0]).toBe("TEST-051");
    fireEvent.change(search, { target: { value: "hang thu" } });
    expect(screen.getByText("1–50 / 121 dòng")).toBeInTheDocument();
    expect(tableCodes()[0]).toBe("TEST-001");
  });
  it("resets pagination when the report snapshot changes", () => {
    const report = largeFixture();
    const view = render(<InventoryMovementV2ReportComponent report={report} />);
    fireEvent.click(pagination().getByRole("button", { name: "Trang sau" }));
    expect(screen.getByText("51–100 / 121 dòng")).toBeInTheDocument();
    view.rerender(<InventoryMovementV2ReportComponent report={{ ...report, generated_at: "2026-11-02T02:00:00Z" }} />);
    expect(screen.getByText("1–50 / 121 dòng")).toBeInTheDocument();
    expect(tableCodes()).toHaveLength(50);
  });
});
