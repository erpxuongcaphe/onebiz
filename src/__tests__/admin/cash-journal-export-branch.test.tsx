import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CashJournalPage from "@/app/(main)/tai-chinh/nhat-ky-thu-chi/page";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  allowed: true,
}));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { id: "u", tenantId: "t" } }) }));
vi.mock("@/lib/permissions/use-permission", () => ({
  usePermissions: () => ({
    isLoading: false,
    hasAny: () => true,
    hasPermission: (code: string) => code === "finance.view_cash_journal_company",
    hasPermissionAtBranch: (code: string, branch: string | null) =>
      mocks.allowed && code === "finance.export_cash_journal" && branch === "a",
  }),
}));
vi.mock("@/lib/services/supabase/cash-journal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/supabase/cash-journal")>()),
  getCashJournal: mocks.load,
  exportCashJournal: mocks.save,
}));
vi.mock("@/app/(main)/tai-chinh/nhat-ky-thu-chi/spend-review", () => ({
  SpendQueue: () => null,
  SpendReview: () => null,
}));

describe("cash journal export by branch", () => {
  beforeEach(() => {
    mocks.allowed = true;
    mocks.load.mockReset().mockResolvedValue({
      scope: "company", totals: { count: 1, receipt: 10, payment: 0, net: 10 },
      pageSize: 50, tooMany: false, rows: [],
      branches: [{ id: "a", label: "Quán A" }, { id: "b", label: "Quán B" }], accounts: [], categories: [],
    });
    mocks.save.mockReset().mockResolvedValue(undefined);
  });

  it("requires an allowed branch and exports that branch only", async () => {
    render(<CashJournalPage />);
    await screen.findByText("Chọn chi nhánh được cấp quyền để xuất Excel.");
    expect(screen.queryByRole("button", { name: "Xuất Excel" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Chi nhánh"), { target: { value: "a" } });
    const exportButton = await screen.findByRole("button", { name: "Xuất Excel" });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.load.mock.calls.some(([filters, , full]) => full === true && filters.branch === "a")).toBe(true);
    fireEvent.change(screen.getByLabelText("Chi nhánh"), { target: { value: "b" } });
    expect(screen.queryByRole("button", { name: "Xuất Excel" })).toBeNull();
  });
  it("cancels an unfinished export when its permission is revoked", async () => {
    let resolveExport: (value: unknown) => void = () => {};
    let exportSignal: AbortSignal | undefined;
    const pending = new Promise(resolve => { resolveExport = resolve; });
    const defaultLoad = mocks.load.getMockImplementation()!;
    mocks.load.mockImplementation((filters, signal, full) => {
      if (full) { exportSignal = signal; return pending; }
      return defaultLoad(filters, signal, full);
    });
    const { rerender } = render(<CashJournalPage />);
    await screen.findByText("Chọn chi nhánh được cấp quyền để xuất Excel.");
    fireEvent.change(screen.getByLabelText("Chi nhánh"), { target: { value: "a" } });
    const exportButton = await screen.findByRole("button", { name: "Xuất Excel" });
    await waitFor(() => expect(exportButton).toBeEnabled());
    fireEvent.click(exportButton);
    await waitFor(() => expect(exportSignal).toBeDefined());
    mocks.allowed = false;
    rerender(<CashJournalPage />);
    await waitFor(() => expect(exportSignal?.aborted).toBe(true));
    await act(async () => { resolveExport({}); await Promise.resolve(); });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
