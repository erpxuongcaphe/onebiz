import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { DeliveryPartnerWithStats } from "@/lib/services/supabase/shipping";

const fixture = vi.hoisted(() => ({ branch: "branch-a", user: "user-a", historyAllowed: true, read: vi.fn(), csv: vi.fn(), toast: vi.fn() }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>COD history fixture</div> }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: fixture.branch, branchLabel: fixture.branch, isReady: true }), useToast: () => ({ toast: fixture.toast }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: fixture.user }, tenant: { id: "tenant" }, hasPermission: (code: string) => code !== "finance.view_cash_book" || fixture.historyAllowed }) }));
vi.mock("@/lib/services/supabase/shipping", () => ({ getDeliveryPartnersWithStats: fixture.read, deactivateDeliveryPartner: vi.fn() }));
vi.mock("@/lib/utils/export", () => ({ exportToCsv: fixture.csv }));
vi.mock("@/components/shared/dialogs", () => ({ CreateDeliveryPartnerDialog: () => null, ConfirmDialog: () => null, SettleCodDialog: () => null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: ({ searchValue, onSearchChange, onExport }: { searchValue: string; onSearchChange: (v: string) => void; onExport?: { csv: () => void } }) => <><input aria-label="Tìm đối tác" value={searchValue} onChange={e => onSearchChange(e.target.value)} />{onExport && <button onClick={onExport.csv}>Xuất CSV</button>}</> }));
vi.mock("@/components/shared/list-page-layout", () => ({ ListPageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shared/list-metric", () => ({ ListMetric: ({ label, value, loading }: { label: string; value: string; loading: boolean }) => <section aria-label={label}>{loading ? "Đang tải" : value}</section> }));
vi.mock("@/components/shared/data-table", () => ({ DataTable: ({ data, onSortingChange }: { data: DeliveryPartnerWithStats[]; onSortingChange: (value: { id: string; desc: boolean }[]) => void }) => <><button onClick={() => onSortingChange([{ id: "codHolding", desc: true }])}>COD giảm dần</button><ul>{data.map(row => <li key={row.id}>{row.name}</li>)}</ul></> }));
vi.mock("@/components/shared/filter-chips", () => ({ FilterChips: () => null }));
vi.mock("@/components/shared/filter-sidebar", () => ({ FilterPanel: ({ children }: { children: ReactNode }) => <>{children}</>, FilterGroup: ({ children }: { children: ReactNode }) => <>{children}</>, RadioFilter: ({ name, options, value, onChange }: { name: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) => <select aria-label={name} value={value} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
import Page from "@/app/(main)/doi-tac/giao-hang/page";
const stats = { activeOrders: 2, deliveredOrders: 1, failedOrders: 0, codHolding: 50, feeCollected: 5 };
function partner(id: string, amount = 50, status: "active" | "inactive" = "active"): DeliveryPartnerWithStats {
  return { id, code: id, name: id, phone: "", status, statusName: status, activeOrders: 2, completedOrders: 1, createdAt: "2026-10-01T00:00:00Z", stats: { ...stats, codHolding: amount } };
}
const result = (data = [partner("Partner-a")]) => ({ data, total: data.length, unassigned: { ...stats, activeOrders: 3, codHolding: 25 }, settlementTracking: true });
beforeEach(() => { fixture.branch = "branch-a"; fixture.user = "user-a"; fixture.historyAllowed = true; fixture.read.mockReset().mockResolvedValue(result()); fixture.csv.mockReset(); fixture.toast.mockReset(); });
afterEach(cleanup);

describe("delivery partner complete workspace", () => {
  it("uses one independently scrolling view instead of stacking two competing tables", async () => {
    render(<Page />); await screen.findByText("Partner-a");
    fireEvent.click(screen.getByRole("tab", { name: "Đối soát COD" }));
    expect(screen.queryByText("Partner-a")).not.toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "Đối soát COD" })).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(screen.getByText("COD history fixture")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xuất CSV" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^Đối tác$/ }));
    expect(screen.getByText("Partner-a")).toBeInTheDocument();
    expect(screen.queryByText("COD history fixture")).not.toBeInTheDocument();
  });

  it("does not offer financial history without its separate permission", async () => {
    fixture.historyAllowed = false;
    render(<Page />); await screen.findByText("Partner-a");
    expect(screen.queryByRole("tab", { name: "Đối soát COD" })).not.toBeInTheDocument();
  });
  it("includes unassigned shipment amounts and exports the same basis", async () => {
    render(<Page />);
    await screen.findByRole("button", { name: "Xuất CSV" });
    expect(within(screen.getByRole("region", { name: "Đơn đang giao" })).getByText("5")).toBeInTheDocument();
    expect(fixture.read).toHaveBeenCalledWith(expect.objectContaining({ fetchAll: true }), { branchId: "branch-a" });
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(fixture.csv.mock.calls[0][0]).toHaveLength(2);
    expect(fixture.csv.mock.calls[0][0][1]).toMatchObject({ name: "Chưa gán đối tác", codHolding: 25, branch: "branch-a" });
  });

  it("filters totals and exports together, sorting the full set before paging", async () => {
    fixture.read.mockResolvedValue(result(Array.from({ length: 121 }, (_, i) => partner(`Partner-${i}`, i, i === 120 ? "inactive" : "active"))));
    render(<Page />);
    await screen.findByRole("button", { name: "Xuất CSV" });
    fireEvent.click(screen.getByRole("button", { name: "COD giảm dần" }));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Partner-120");
    fireEvent.change(screen.getByRole("combobox", { name: "delivery-partner-status" }), { target: { value: "inactive" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Đơn đang giao" })).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(fixture.csv.mock.calls[0][0]).toHaveLength(1);
    expect(fixture.csv.mock.calls[0][0][0].code).toBe("Partner-120");
  });

  it.each(["branch", "account"])("rejects old %s responses and hides stale data/export immediately", async change => {
    let resolve!: (value: ReturnType<typeof result>) => void;
    fixture.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<Page />);
    if (change === "branch") fixture.branch = "branch-b"; else fixture.user = "user-b";
    fixture.read.mockResolvedValue(result([partner("Current")]));
    view.rerender(<Page />);
    await screen.findByText("Current");
    await act(async () => { resolve(result([partner("Old")])); });
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
    fixture.read.mockReturnValue(new Promise(() => {}));
    fixture.branch = "branch-c"; view.rerender(<Page />);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xuất CSV" })).not.toBeInTheDocument();
  });

  it("does not leave old totals or export available after failure", async () => {
    const view = render(<Page />); await screen.findByText("Partner-a");
    fixture.read.mockRejectedValue(new Error("Fixture unavailable")); fixture.branch = "branch-b"; view.rerender(<Page />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fixture unavailable");
    expect(screen.queryByText("Partner-a")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xuất CSV" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "COD đang giữ" })).toHaveTextContent("Không tải được");
  });

  it("masks cash metrics and exported amounts when settlement tracking is unavailable", async () => {
    fixture.read.mockResolvedValue({ ...result(), settlementTracking: false });
    render(<Page />); await screen.findByRole("button", { name: "Xuất CSV" });
    expect(screen.getByRole("region", { name: "COD đang giữ" })).toHaveTextContent("Chưa đủ nguồn");
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(fixture.csv.mock.calls[0][0].every((row: { codHolding: unknown }) => row.codHolding === "")).toBe(true);
  });

  it("searches the complete loaded directory without rereading shipment history on each keystroke", async () => {
    fixture.read.mockResolvedValue(result([partner("Partner-a"), partner("Partner-b")]));
    render(<Page />); await screen.findByText("Partner-a");
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm đối tác" }), { target: { value: "Partner-b" } });
    expect(screen.queryByText("Partner-a")).not.toBeInTheDocument();
    expect(screen.getByText("Partner-b")).toBeInTheDocument();
    expect(fixture.read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    expect(fixture.csv.mock.calls[0][0]).toHaveLength(1);
  });
});
