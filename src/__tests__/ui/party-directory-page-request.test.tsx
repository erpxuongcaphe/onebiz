import type { ReactNode } from "react";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "branch-a", toast: vi.fn(), customer: vi.fn(), supplier: vi.fn(), excel: vi.fn(), csv: vi.fn(), invoices: vi.fn(), orders: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ user: { id: "user-a" }, tenant: { id: "tenant-a" }, hasPermission: () => true }),
  useBranchFilter: () => ({ activeBranchId: state.branch, isReady: true }), useToast: () => ({ toast: state.toast }),
}));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user: { id: "user-a" }, tenant: { id: "tenant-a" }, hasPermission: () => true }) }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: () => ({ hasPermission: () => true }) }));
vi.mock("@/lib/hooks/use-revalidate-on-focus", () => ({ useRevalidateOnFocus: vi.fn() }));
vi.mock("@/lib/hooks/use-breakpoint", () => ({ useBreakpoint: () => true }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: ({ searchValue, onSearchChange, onExport }: {
  searchValue: string; onSearchChange: (value: string) => void; onExport: { excel: () => void; csv: () => void };
}) => <><input aria-label="Tìm danh sách" value={searchValue} onChange={event => onSearchChange(event.target.value)} /><button onClick={onExport.excel}>Xuất Excel</button><button onClick={onExport.csv}>Xuất CSV</button></> }));
vi.mock("@/components/shared/list-page-layout", () => ({ ListPageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shared/data-table", () => ({ StarCell: () => null, DataTable: ({ data, toolbarMetrics, loading, emptyTitle, columns, renderDetail }: {
  data: { id: string; name: string }[]; toolbarMetrics: ReactNode; loading: boolean; emptyTitle: string; columns: { header?: string }[];
  renderDetail: (row: { id: string; name: string }, close: () => void) => ReactNode;
}) => { const [open, setOpen] = useState(false); return <section>{toolbarMetrics}<div>{columns.filter(column => typeof column.header === "string").map(column => <span key={column.header}>{column.header}</span>)}</div>{loading ? <p>Đang tải danh sách</p> : data.length ? data.map(row => <p key={row.id}>{row.name}</p>) : <p>{emptyTitle}</p>}{data[0] && <button onClick={() => setOpen(true)}>Mở chi tiết</button>}{open && data[0] && renderDetail(data[0], () => setOpen(false))}</section>; } }));
vi.mock("@/components/shared/saved-views-tabs", () => ({ SavedViewsTabs: () => null }));
vi.mock("@/components/shared/dialogs", () => ({ ChangeCustomerCodeDialog: () => null, ConfirmDialog: () => null }));
vi.mock("@/components/shared/dialogs/import-excel-dialog", () => ({ ImportExcelDialog: () => null }));
vi.mock("@/components/shared/dialogs/otp-approval-dialog", () => ({ OtpApprovalDialog: () => null }));
vi.mock("@/components/shared/party-cash-history", () => ({ PartyCashHistory: () => null }));
vi.mock("@/components/shared/fnb-invoice-context", () => ({ FnbInvoiceContext: () => null }));
vi.mock("@/lib/services", () => ({ getCustomerListWorkspace: state.customer, getSupplierListWorkspace: state.supplier,
  getCustomerGroupsAsync: async () => [], deleteCustomer: vi.fn(), deleteSupplier: vi.fn(), getInvoicesForCustomer: state.invoices,
  getReturnsForCustomer: async () => [], getLoyaltyTransactions: async () => ({ data: [] }), getPurchaseOrdersForSupplier: state.orders, getPurchaseOrderStatusMeta: () => ({}) }));
vi.mock("@/lib/services/supabase/party-directory-workspace", () => ({ getScopedCustomerDirectory: state.customer, getScopedSupplierDirectory: state.supplier }));
vi.mock("@/lib/services/supabase/party-history-workspace", () => ({ getScopedPartyHistory: state.history }));
vi.mock("@/lib/services/supabase/customers", () => ({ standardizeWalkInCustomerCode: vi.fn() }));
vi.mock("@/lib/services/supabase/excel-import", () => ({ bulkImportCustomers: vi.fn(), bulkImportSuppliers: vi.fn() }));
vi.mock("@/lib/services/supabase/supplier-return-history", () => ({ getSupplierReturnHistory: vi.fn() }));
vi.mock("@/lib/excel", () => ({ downloadTemplate: vi.fn(), exportToExcelFromSchema: state.excel }));
vi.mock("@/lib/utils/export", () => ({ exportToCsv: state.csv }));
import CustomerPage from "@/app/(main)/khach-hang/page";
import SupplierPage from "@/app/(main)/hang-hoa/nha-cung-cap/page";

function payload(name: string, activity = true, debt = true) {
  return { contacts: [{ id: name, name, code: name, phone: "", type: "individual", isActive: false, createdAt: "2026-10-01T00:00:00Z",
    activity: activity ? 100 : null, debt: debt ? 20 : null, returns: activity ? 0 : null, orders: activity ? 1 : null, lastPurchaseAt: null }], total: 1,
    revision: "a".repeat(32), scope: { scope: "branch", branchIds: [state.branch] },
    activity: activity ? 100 : null, debt: debt ? 20 : null, returns: activity ? 0 : null, netSales: activity ? 100 : null,
    partiesWithDebt: debt ? 1 : null, canViewActivity: activity, canViewDebt: debt };
}
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.clearAllMocks(); state.branch = "branch-a";
  state.customer.mockReset().mockResolvedValue(payload("Customer A"));
  state.supplier.mockReset().mockResolvedValue(payload("Supplier A"));
  state.invoices.mockResolvedValue([]); state.orders.mockResolvedValue([]);
  state.history.mockReset().mockResolvedValue({ rows: [], canViewDebt: false });
});
describe.each([
  { name: "customer", Page: CustomerPage, read: state.customer, contact: "Customer A" },
  { name: "supplier", Page: SupplierPage, read: state.supplier, contact: "Supplier A" },
])("$name page request presentation", ({ Page, read, contact }) => {
  it("clears old rows/totals after failed filtering, blocks export and retries the selected filter", async () => {
    render(<Page />);
    await screen.findByText(contact);
    read.mockRejectedValueOnce(new Error("Temporary read failure"));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm danh sách" }), { target: { value: "next" } });
    await screen.findByRole("alert");
    expect(screen.queryByText(contact)).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("Chưa tải được danh sách")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    expect(state.excel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    await screen.findByText(contact);
    expect(read.mock.calls.at(-1)?.[0].search).toBe("next");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    await waitFor(() => expect(state.excel).toHaveBeenCalledTimes(1));
    expect(read.mock.calls.at(-1)?.[1].exportAll).toBe(true);
  });
  it("hides the previous branch rows while a new branch request is pending", async () => {
    const view = render(<Page />);
    await screen.findByText(contact);
    read.mockImplementation(() => new Promise(() => {}));
    state.branch = "branch-b"; view.rerender(<Page />);
    expect(screen.queryByText(contact)).not.toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" })); });
    expect(state.excel).not.toHaveBeenCalled();
  });
  it("hides financial metrics, columns and CSV fields for contact-only access", async () => {
    read.mockResolvedValue(payload(contact, false, false));
    render(<Page />); await screen.findByText(contact);
    for (const label of ["Doanh số", "Doanh số ròng", "Công nợ", "Số dư công nợ", "Tổng mua", "Tổng bán"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Xuất CSV" }));
    await waitFor(() => expect(state.csv).toHaveBeenCalledTimes(1));
    expect(state.csv.mock.calls[0][1].map((column: { key: string }) => column.key)).not.toEqual(expect.arrayContaining(["currentDebt"]));
    expect(state.csv.mock.calls[0][1].map((column: { key: string }) => column.key)).not.toEqual(expect.arrayContaining(["totalSales"]));
    expect(state.csv.mock.calls[0][1].map((column: { key: string }) => column.key)).not.toEqual(expect.arrayContaining(["totalPurchases"]));
  });
  it("exports the full result returned through the separate export permission path", async () => {
    render(<Page />); await screen.findByText(contact);
    const all = payload(contact);
    all.contacts = Array.from({ length: 453 }, (_, index) => ({ ...all.contacts[0], id: `contact-${index}`, code: `C-${index}` })); all.total = 453;
    read.mockResolvedValueOnce(all);
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    await waitFor(() => expect(state.excel).toHaveBeenCalledTimes(1));
    expect(state.excel.mock.calls[0][0]).toHaveLength(453);
    expect(state.excel.mock.calls[0][0][0].isActive).toBe(false);
  });
  it("discards an export if filters change before it completes", async () => {
    render(<Page />); await screen.findByText(contact);
    let complete!: (value: ReturnType<typeof payload>) => void;
    read.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm danh sách" }), { target: { value: "next" } });
    await act(async () => { complete(payload(contact)); });
    expect(state.excel).not.toHaveBeenCalled();
  });
  it("does not query sales/purchase history or show financial detail tabs for contact-only access", async () => {
    read.mockResolvedValue(payload(contact, false, false));
    render(<Page />); await screen.findByText(contact);
    fireEvent.click(screen.getByRole("button", { name: "Mở chi tiết" }));
    await act(async () => {});
    expect(state.invoices).not.toHaveBeenCalled(); expect(state.orders).not.toHaveBeenCalled();
    expect(state.history).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab", { name: /Lịch sử mua hàng|Lịch sử bán hàng|Nợ cần thu|Công nợ|Thu chi/ })).not.toBeInTheDocument();
  });
  it("reads detail history through the scoped facade, never broad document readers", async () => {
    render(<Page />); await screen.findByText(contact);
    fireEvent.click(screen.getByRole("button", { name: "Mở chi tiết" }));
    await waitFor(() => expect(state.history).toHaveBeenCalledWith(Page === CustomerPage ? "customer" : "supplier", contact, "branch-a"));
    expect(state.invoices).not.toHaveBeenCalled(); expect(state.orders).not.toHaveBeenCalled();
  });
});
