import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SoQuyPage from "@/app/(main)/so-quy/page";

const stub = vi.hoisted(() => ({
  branch: "aaaaaaaa-1234-4123-8123-123456789012",
  canRead: true,
  workspace: vi.fn(),
  all: vi.fn(),
  excel: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: stub.toast }),
  useBranchFilter: () => ({ activeBranchId: stub.branch, branchLabel: "Quán mẫu", isReady: true }),
}));
vi.mock("@/lib/permissions/use-permission", () => ({
  usePermissions: () => ({ hasAny: (permissions: string[]) => stub.canRead && permissions.includes("finance.view_cash_book"), isLoading: false }),
}));
vi.mock("@/lib/permissions", () => ({ useTxRowPermissions: () => ({}) }));
vi.mock("@/lib/services", () => ({
  getCashBookListWorkspace: stub.workspace,
  getAllCashBookEntries: stub.all,
  cancelCashTransaction: vi.fn(),
}));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: ({ title, onExport }: { title: string; onExport?: { excel: () => void } }) => <><h1>{title}</h1>{onExport && <button onClick={onExport.excel}>Xuất Excel</button>}</> }));
vi.mock("@/lib/utils/excel-export", async original => ({
  ...await original<typeof import("@/lib/utils/excel-export")>(), exportReportToExcel: stub.excel,
}));
vi.mock("@/components/shared/list-page-layout", () => ({ ListPageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shared/data-table", () => ({
  StarCell: () => null,
  DataTable: ({ onPageChange, total }: { onPageChange: (page: number) => void; total: number }) => <><output aria-label="Số dòng kiểm thử">{total}</output><button onClick={() => onPageChange(1)}>Trang sau</button></>,
}));
vi.mock("@/components/shared/audit-log-dialog", () => ({ AuditLogDialog: () => null }));
vi.mock("@/components/shared/dialogs", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/shared/dialogs/import-excel-dialog", () => ({ ImportExcelDialog: () => null }));

const branch = "aaaaaaaa-1234-4123-8123-123456789012";
const url = `/so-quy?drilldown=cash-flow&branch=${branch}&from=2026-10-05&to=2026-10-21&type=payment`;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: false, addEventListener() {}, removeEventListener() {} }));
  stub.branch = branch;
  stub.canRead = true;
  stub.all.mockReset();
  stub.excel.mockReset();
  stub.workspace.mockReset().mockResolvedValue({
    data: [], total: 40, categoryOptions: [],
    summary: { totalReceipt: 0, totalPayment: 20, openingBalance: 100, closingBalance: 80, receiptCount: 0, paymentCount: 40 },
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Sổ quỹ report entry point", () => {
  it("does not let a delayed branch response overwrite the visible list", async () => {
    const payload = (total: number) => ({ data: [], total, categoryOptions: [], summary: {
      totalReceipt: 0, totalPayment: 0, openingBalance: 0, closingBalance: 0, receiptCount: 0, paymentCount: 0,
    } });
    let finish!: (value: ReturnType<typeof payload>) => void;
    stub.workspace.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(payload(12));
    window.history.replaceState(null, "", "/so-quy");
    const view = render(<SoQuyPage />);
    await waitFor(() => expect(stub.workspace).toHaveBeenCalledTimes(1));
    stub.branch = "bbbbbbbb-1234-4123-8123-123456789012";
    view.rerender(<SoQuyPage />);
    await waitFor(() => expect(screen.getByLabelText("Số dòng kiểm thử")).toHaveTextContent("12"));
    await act(async () => finish(payload(99)));
    expect(screen.getByLabelText("Số dòng kiểm thử")).toHaveTextContent("12");
  });

  it("does not save a workbook prepared for a previous branch", async () => {
    let finish!: (rows: []) => void;
    stub.all.mockReturnValueOnce(new Promise<[]>(resolve => { finish = resolve; }));
    window.history.replaceState(null, "", "/so-quy");
    const view = render(<SoQuyPage />);
    await act(async () => {});
    fireEvent.click(await screen.findByRole("button", { name: "Xuất Excel" }));
    expect(stub.all).toHaveBeenCalledWith(expect.objectContaining({ branchId: branch }));
    stub.branch = "bbbbbbbb-1234-4123-8123-123456789012";
    view.rerender(<SoQuyPage />);
    await act(async () => finish([]));
    expect(stub.excel).not.toHaveBeenCalled();
  });

  const reportHref = process.env.ONEBIZ_TEST_CASH_BOOK_HREF;
  it.skipIf(!reportHref)("loads the link captured from the report browser session", async () => {
    window.history.replaceState(null, "", reportHref!);
    render(<SoQuyPage />);
    await waitFor(() => expect(stub.workspace).toHaveBeenCalled());
    expect(stub.workspace.mock.calls[0][0]).toMatchObject({
      branchId: branch, dateFrom: "2026-10-01", dateToExclusive: "2026-11-01",
      types: ["payment"], statuses: ["completed"],
    });
  });

  it("loads only the transferred period, branch and completed payment on the first request", async () => {
    window.history.replaceState(null, "", url);
    render(<SoQuyPage />);
    await waitFor(() => expect(stub.workspace).toHaveBeenCalled());
    expect(stub.workspace.mock.calls[0][0]).toMatchObject({
      branchId: branch, dateFrom: "2026-10-05", dateToExclusive: "2026-10-22",
      types: ["payment"], statuses: ["completed"], page: 0, pageSize: 15,
    });
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    await waitFor(() => expect(stub.workspace).toHaveBeenLastCalledWith(expect.objectContaining({
      branchId: branch, dateFrom: "2026-10-05", dateToExclusive: "2026-10-22",
      types: ["payment"], statuses: ["completed"], page: 1, pageSize: 15,
    })));
  });

  it.each(["invalid period", "other branch", "no permission"])("does not fetch on %s", async failure => {
    if (failure === "other branch") stub.branch = "bbbbbbbb-1234-4123-8123-123456789012";
    if (failure === "no permission") stub.canRead = false;
    window.history.replaceState(null, "", failure === "invalid period" ? url.replace("2026-10-21", "2026-10-03") : url);
    render(<SoQuyPage />);
    await screen.findByRole("alert");
    expect(stub.workspace).not.toHaveBeenCalled();
  });

  it("keeps the direct menu's default document types and statuses", async () => {
    window.history.replaceState(null, "", "/so-quy");
    render(<SoQuyPage />);
    await waitFor(() => expect(stub.workspace).toHaveBeenCalled());
    expect(stub.workspace.mock.calls[0][0]).toMatchObject({ types: ["receipt", "payment"], statuses: ["completed", "draft"] });
  });
});
