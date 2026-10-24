import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ branch: "branch-a", toast: vi.fn(), customer: vi.fn(), supplier: vi.fn(), excel: vi.fn() }));
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
  searchValue: string; onSearchChange: (value: string) => void; onExport: { excel: () => void };
}) => <><input aria-label="Tìm danh sách" value={searchValue} onChange={event => onSearchChange(event.target.value)} /><button onClick={onExport.excel}>Xuất Excel</button></> }));
vi.mock("@/components/shared/list-page-layout", () => ({ ListPageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shared/data-table", () => ({ StarCell: () => null, DataTable: ({ data, toolbarMetrics, loading, emptyTitle }: {
  data: { id: string; name: string }[]; toolbarMetrics: ReactNode; loading: boolean; emptyTitle: string;
}) => <section>{toolbarMetrics}{loading ? <p>Đang tải danh sách</p> : data.length ? data.map(row => <p key={row.id}>{row.name}</p>) : <p>{emptyTitle}</p>}</section> }));
vi.mock("@/components/shared/saved-views-tabs", () => ({ SavedViewsTabs: () => null }));
vi.mock("@/components/shared/dialogs", () => ({ ChangeCustomerCodeDialog: () => null, ConfirmDialog: () => null }));
vi.mock("@/components/shared/dialogs/import-excel-dialog", () => ({ ImportExcelDialog: () => null }));
vi.mock("@/components/shared/dialogs/otp-approval-dialog", () => ({ OtpApprovalDialog: () => null }));
vi.mock("@/components/shared/party-cash-history", () => ({ PartyCashHistory: () => null }));
vi.mock("@/components/shared/fnb-invoice-context", () => ({ FnbInvoiceContext: () => null }));
vi.mock("@/lib/services", () => ({ getCustomerListWorkspace: state.customer, getSupplierListWorkspace: state.supplier,
  getCustomerGroupsAsync: async () => [], deleteCustomer: vi.fn(), deleteSupplier: vi.fn(), getInvoicesForCustomer: vi.fn(),
  getReturnsForCustomer: vi.fn(), getLoyaltyTransactions: vi.fn(), getPurchaseOrdersForSupplier: vi.fn(), getPurchaseOrderStatusMeta: () => ({}) }));
vi.mock("@/lib/services/supabase/customers", () => ({ standardizeWalkInCustomerCode: vi.fn() }));
vi.mock("@/lib/services/supabase/excel-import", () => ({ bulkImportCustomers: vi.fn(), bulkImportSuppliers: vi.fn() }));
vi.mock("@/lib/services/supabase/supplier-return-history", () => ({ getSupplierReturnHistory: vi.fn() }));
vi.mock("@/lib/excel", () => ({ downloadTemplate: vi.fn(), exportToExcelFromSchema: state.excel }));
import CustomerPage from "@/app/(main)/khach-hang/page";
import SupplierPage from "@/app/(main)/hang-hoa/nha-cung-cap/page";

function payload(name: string) {
  return { data: [{ id: name, name, code: name, phone: "", type: "individual", currentDebt: 20, totalSales: 100, totalSalesMinusReturns: 100, totalPurchases: 100 }], total: 1,
    summary: { totalSales: 100, totalReturns: 0, netSales: 100, totalDebt: 20, customersWithDebt: 1, totalPurchases: 100, suppliersWithDebt: 1 } };
}
beforeEach(() => {
  vi.clearAllMocks(); state.branch = "branch-a";
  state.customer.mockReset().mockResolvedValue(payload("Customer A"));
  state.supplier.mockReset().mockResolvedValue(payload("Supplier A"));
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
    expect(state.excel).toHaveBeenCalledTimes(1);
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
});
