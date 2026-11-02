import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryMovementV2Report } from "@/lib/reports/inventory-movement-v2-contract";

const mocks = vi.hoisted(() => ({ read: vi.fn(), units: vi.fn(), authLoading: false, ready: true,
  tenant: "tenant-a", user: "user-a", branch: "branch-a" as string | undefined,
  permissions: new Set(["reports.analytics", "reports.view_detail"]) }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ tenant: mocks.tenant ? { id: mocks.tenant } : null, user: mocks.user ? { id: mocks.user } : null,
    permissions: mocks.permissions, hasPermission: (key: string) => mocks.permissions.has(key), isLoading: mocks.authLoading }),
  useBranchFilter: () => ({ activeBranchId: mocks.branch, isReady: mocks.ready }),
}));
vi.mock("@/lib/services/supabase/inventory-movement-v2", () => ({ getInventoryMovementV2Report: mocks.read }));
vi.mock("@/lib/services/supabase/report-stock-units", () => ({ getStockReportUnits: mocks.units, stockUnitReferenceKey: (reference: string, product: string) => `${reference}:${product}` }));
vi.mock("@/components/shared/report/inventory-movement-v2-report", () => ({ default: (props: {
  report: InventoryMovementV2Report | null; conversions?: ReadonlyMap<string, string>;
  loading: boolean; error: string | null; onReload: () => void; canExportView: boolean; canExportFull: boolean;
  viewMode: "chart" | "table"; onViewModeChange: (mode: "chart" | "table") => void; readScope: string;
}) => <div>
  {props.loading ? <p role="status">Loading V2</p> : props.error ? <p role="alert">{props.error}</p> : <p>{props.report?.rows[0]?.name ?? "Empty V2"}</p>}
  <output aria-label="Quy đổi">{props.conversions ? [...props.conversions.values()].join(";") || "Loaded empty" : "Unloaded"}</output>
  <output aria-label="Quyền giá vốn">{String(props.report?.cost_visible ?? false)}</output>
  <output aria-label="Số lượng">{props.report?.rows[0]?.current_qty ?? ""}</output>
  <button onClick={props.onReload}>Tải lại</button>
  <output aria-label="Góc nhìn">{props.viewMode}</output>
  <button onClick={() => props.onViewModeChange("chart")}>Biểu đồ</button><button onClick={() => props.onViewModeChange("table")}>Bảng số liệu</button>
  {props.canExportView && <button>Export view</button>}{props.canExportFull && <button>Export full</button>}
</div> }));
import Page from "@/app/(main)/phan-tich/aging/page";

// Route fixtures represent the validated service boundary, not raw parser inputs.
function report(name = "Synthetic A", branch: string | null = mocks.branch ?? null): InventoryMovementV2Report {
  return { tenant_id: mocks.tenant, branch_id: branch, cost_visible: false,
    rows: [{ product_id: "product-a", branch_id: branch ?? "branch-a", name, catalog_unit: "Lon" }],
  } as InventoryMovementV2Report;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

describe("inventory V2 route scope and permissions", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/phan-tich/aging");
    vi.clearAllMocks(); mocks.authLoading = false; mocks.ready = true; mocks.tenant = "tenant-a"; mocks.user = "user-a"; mocks.branch = "branch-a";
    mocks.permissions = new Set(["reports.analytics", "reports.view_detail"]);
    mocks.read.mockReset().mockImplementation(async () => report());
    mocks.units.mockReset().mockResolvedValue(new Map([["product-a:product-a", { catalogUnit: "Lon", currentConversion: "1 thùng = 24 lon" }]]));
  });
  it("loads quantity-only data without cost permission and reads units only for returned product IDs", async () => {
    render(<Page />); await screen.findByText("Synthetic A");
    expect(mocks.read).toHaveBeenCalledWith({ branchId: "branch-a", signal: expect.any(AbortSignal) });
    expect(mocks.units).toHaveBeenCalledWith([{ referenceId: "product-a", productId: "product-a", actualQuantity: 0 }], "current_stock");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("1 thùng = 24 lon");
    expect(screen.queryByText("Export view")).not.toBeInTheDocument();
    expect(screen.queryByText("Export full")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Góc nhìn")).toHaveTextContent("table");
  });
  it("restores view=chart and updates the URL without refetching the current snapshot", async () => {
    window.history.replaceState({}, "", "/phan-tich/aging?view=chart");
    render(<Page />); await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Góc nhìn")).toHaveTextContent("chart");
    fireEvent.click(screen.getByText("Bảng số liệu"));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("view")).toBe("table"));
    expect(screen.getByLabelText("Góc nhìn")).toHaveTextContent("table");
    fireEvent.click(screen.getByText("Biểu đồ"));
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("view")).toBe("chart"));
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it("passes null for all-branch scope and preserves server cost visibility", async () => {
    mocks.branch = undefined;
    mocks.read.mockResolvedValue({ ...report("Company", null), cost_visible: true });
    render(<Page />); await screen.findByText("Company");
    expect(mocks.read.mock.calls[0][0].branchId).toBeNull();
    expect(screen.getByLabelText("Quyền giá vốn")).toHaveTextContent("true");
  });
  it.each([[], ["reports.analytics"], ["reports.view_detail"], ["products.view_cost"]].map(permissions => ({ permissions })))("denies missing required report permissions $permissions without reads", ({ permissions }) => {
    mocks.permissions = new Set(permissions); render(<Page />);
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa được cấp quyền");
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.units).not.toHaveBeenCalled();
  });
  it.each([[true, false], [false, true], [true, true]])("keeps export view/full capabilities separate %s/%s", async (view, full) => {
    if (view) mocks.permissions.add("reports.export"); if (full) mocks.permissions.add("reports.export_detail");
    render(<Page />); await screen.findByText("Synthetic A");
    expect(!!screen.queryByText("Export view")).toBe(view); expect(!!screen.queryByText("Export full")).toBe(full);
  });
  it("waits for auth/branch readiness and rejects scope-mismatched responses", async () => {
    mocks.ready = false; const view = render(<Page />);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.ready = true; mocks.authLoading = true; view.rerender(<Page />);
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.authLoading = false; mocks.read.mockResolvedValue(report("Foreign", "branch-b")); view.rerender(<Page />);
    await screen.findByRole("alert"); expect(screen.queryByText("Foreign")).not.toBeInTheDocument();
    expect(mocks.units).not.toHaveBeenCalled();
  });
  it("accepts empty snapshots without old-source fallback", async () => {
    mocks.read.mockResolvedValue({ ...report(), rows: [] }); render(<Page />);
    await screen.findByText("Empty V2"); expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.units).toHaveBeenCalledWith([], "current_stock");
  });
  it("keeps conversion failures unloaded instead of an empty successful map", async () => {
    mocks.units.mockRejectedValue(new Error("unit failure")); render(<Page />);
    await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
    expect(screen.getByText(/Chưa tải được quy đổi hiện tại/)).toBeInTheDocument();
  });
  it("does not label an incomplete conversion response as no conversions", async () => {
    mocks.units.mockResolvedValue(new Map()); render(<Page />);
    await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
    expect(screen.getByText(/Chưa tải được quy đổi hiện tại/)).toBeInTheDocument();
  });
  it.each([null, undefined, "", "  ", "kg", "g"])("keeps enrichment unavailable for missing/mismatched helper catalogUnit %j", async catalogUnit => {
    const source = report(); source.rows[0].catalog_unit = "G"; source.rows[0].current_qty = "123.4567890123";
    mocks.read.mockResolvedValue(source);
    mocks.units.mockResolvedValue(new Map([["product-a:product-a", { catalogUnit, currentConversion: "Không có quy đổi phụ" }]]));
    render(<Page />); await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
    expect(screen.getByText(/Chưa tải được quy đổi hiện tại/)).toBeInTheDocument();
    expect(source.rows[0].catalog_unit).toBe("G");
    expect(screen.getByLabelText("Số lượng")).toHaveTextContent("123.4567890123");
  });
  it.each([null, "", "  "])("does not enrich a snapshot with missing unit %j", async catalogUnit => {
    const source = report(); source.rows[0].catalog_unit = catalogUnit;
    mocks.read.mockResolvedValue(source); render(<Page />); await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
    expect(source.rows[0].catalog_unit).toBe(catalogUnit);
  });
  it("matches units by exact trimmed value without converting snapshot quantities", async () => {
    const source = report(); source.rows[0].catalog_unit = " G "; source.rows[0].current_qty = "123.4567890123";
    mocks.read.mockResolvedValue(source);
    mocks.units.mockResolvedValue(new Map([["product-a:product-a", { catalogUnit: " G ", currentConversion: "1 kg = 1000 G" }]]));
    render(<Page />); await screen.findByText("Synthetic A");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("1 kg = 1000 G");
    expect(screen.getByLabelText("Số lượng")).toHaveTextContent("123.4567890123");
    expect(source.rows[0].current_qty).toBe("123.4567890123");
  });
  it("checks the unit of every branch row for a repeated product", async () => {
    mocks.branch = undefined;
    const source = report("Company", null);
    source.rows.push({ ...source.rows[0], branch_id: "branch-b", catalog_unit: "kg" });
    mocks.read.mockResolvedValue(source); render(<Page />); await screen.findByText("Company");
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
  });
  it("hides an already loaded snapshot immediately while the next branch is pending", async () => {
    const pending = deferred<InventoryMovementV2Report>();
    mocks.read.mockResolvedValueOnce(report("Old branch")).mockReturnValueOnce(pending.promise);
    const view = render(<Page />); await screen.findByText("Old branch");
    mocks.branch = "branch-b"; view.rerender(<Page />);
    expect(screen.queryByText("Old branch")).not.toBeInTheDocument();
    expect(screen.getByText("Loading V2")).toBeInTheDocument();
    expect(screen.getByLabelText("Quy đổi")).toHaveTextContent("Unloaded");
    await act(async () => pending.resolve(report("New branch")));
    await screen.findByText("New branch");
  });
  it("shows a source error without fallback and retries explicitly", async () => {
    mocks.read.mockRejectedValueOnce(new Error("private source error")); render(<Page />);
    await screen.findByRole("alert"); expect(mocks.units).not.toHaveBeenCalled();
    expect(screen.queryByText(/private source error/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Tải lại")); await screen.findByText("Synthetic A"); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it.each(["branch", "tenant", "user", "permissions"] as const)("hides old data and aborts/discards late source after %s changes", async field => {
    const old = deferred<InventoryMovementV2Report>();
    mocks.read.mockResolvedValueOnce(report("Visible old")).mockReturnValueOnce(old.promise).mockImplementation(async () => report("Current"));
    const view = render(<Page />); await screen.findByText("Visible old");
    fireEvent.click(screen.getByText("Tải lại"));
    expect(screen.queryByText("Visible old")).not.toBeInTheDocument();
    const signal = mocks.read.mock.calls[1][0].signal as AbortSignal;
    const obsolete = report("Late old");
    if (field === "branch") mocks.branch = "branch-b";
    if (field === "tenant") mocks.tenant = "tenant-b";
    if (field === "user") mocks.user = "user-b";
    if (field === "permissions") mocks.permissions.add("reports.export");
    view.rerender(<Page />); expect(signal.aborted).toBe(true);
    await screen.findByText("Current");
    await act(async () => old.resolve(obsolete));
    expect(screen.queryByText("Late old")).not.toBeInTheDocument();
  });
  it("discards late conversions and aborts on permission revocation/unmount", async () => {
    const units = deferred<Map<string, { currentConversion: string }>>();
    mocks.units.mockReturnValueOnce(units.promise);
    const view = render(<Page />); await waitFor(() => expect(mocks.units).toHaveBeenCalledOnce());
    const signal = mocks.read.mock.calls[0][0].signal as AbortSignal;
    mocks.permissions = new Set(); view.rerender(<Page />);
    expect(signal.aborted).toBe(true);
    await act(async () => units.resolve(new Map([["product-a:product-a", { currentConversion: "Old units" }]])));
    expect(screen.queryByText("Synthetic A")).not.toBeInTheDocument();
    expect(screen.queryByText("Old units")).not.toBeInTheDocument();
    mocks.permissions = new Set(["reports.analytics", "reports.view_detail"]);
    view.rerender(<Page />); await screen.findByText("Synthetic A");
    const latestSignal = mocks.read.mock.calls.at(-1)![0].signal as AbortSignal;
    view.unmount(); expect(latestSignal.aborted).toBe(true);
  });
});
