import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MoneyAccountsPage from "@/app/(main)/cai-dat/tai-khoan-tien/money-account-workspace";
import { cashAccountBalancesHref } from "@/lib/reports/cash-book-drilldown";

const stub = vi.hoisted(() => ({
  branch: "aaaaaaaa-1234-4123-8123-123456789012",
  canRead: true,
  canExport: true,
  workspace: vi.fn(),
  accounts: vi.fn(),
  excel: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({
  useBranchFilter: () => ({ activeBranchId: stub.branch, branchLabel: "Quán mẫu", isReady: true }),
}));
vi.mock("@/lib/permissions/use-permission", () => ({
  usePermissions: () => ({ hasPermission: (permission: string) => permission === "finance.view_cash_book" ? stub.canRead : permission === "reports.export" && stub.canExport, isLoading: false }),
}));
vi.mock("@/lib/services/supabase/money-accounts", () => ({
  getMoneyAccounts: stub.accounts,
  getMoneyAccountWorkspace: stub.workspace,
}));
vi.mock("@/lib/utils/export", () => ({ exportToExcel: stub.excel }));
vi.mock("@/app/(main)/cai-dat/tai-khoan-tien/money-account-editor", () => ({ MoneyAccountEditor: () => null }));

const branch = "aaaaaaaa-1234-4123-8123-123456789012";
const period = { from: "2026-09-15", to: "2026-10-03" };
const url = cashAccountBalancesHref(branch, period)!;

beforeEach(() => {
  stub.branch = branch;
  stub.canRead = true;
  stub.canExport = true;
  stub.accounts.mockReset().mockResolvedValue([]);
  stub.excel.mockReset().mockResolvedValue(undefined);
  stub.workspace.mockReset().mockResolvedValue({
    unassigned_count: 0,
    accounts: [{ id: "account-1", code: "Q1", name: "Quỹ mẫu", kind: "cash", active: true, opening_date: "2026-09-01", opening_amount: 1000, opening_balance: 1000, receipts: 200, payments: 100, closing_balance: 1100 }],
  });
});
afterEach(cleanup);

describe("account balances from the cash report", () => {
  it("opens the real balances tab with the exact full period and exports that scope", async () => {
    window.history.replaceState(null, "", url + "&type=receipt&cashSearch=anything");
    render(<MoneyAccountsPage />);
    await waitFor(() => expect(stub.workspace).toHaveBeenCalledExactlyOnceWith(branch, period.from, period.to));
    expect(stub.accounts).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Số dư & thu chi" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Từ ngày")).toHaveValue(period.from);
    expect(screen.getByLabelText("Đến ngày")).toHaveValue(period.to);
    await screen.findByRole("cell", { name: "Quỹ mẫu" });
    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel" }));
    expect(stub.excel.mock.calls[0][0]).toEqual([expect.objectContaining({
      ...period, branch: "Quán mẫu", opening_balance: 1000, receipts: 200, payments: 100, closing_balance: 1100,
    })]);
    expect(stub.excel.mock.calls[0][1]).toHaveLength(16);
  });

  it.each(["wrong branch", "no read permission", "invalid range"])("never loads the register on %s", async reason => {
    if (reason === "wrong branch") stub.branch = "bbbbbbbb-1234-4123-8123-123456789012";
    if (reason === "no read permission") stub.canRead = false;
    window.history.replaceState(null, "", reason === "invalid range" ? url.replace(period.to, "2026-09-01") : url);
    render(<MoneyAccountsPage />);
    await screen.findByRole("alert");
    expect(stub.workspace).not.toHaveBeenCalled();
    expect(stub.accounts).not.toHaveBeenCalled();
  });

  it("preserves the list tab when opened from settings and blocks export without permission", async () => {
    stub.canExport = false;
    window.history.replaceState(null, "", "/cai-dat/tai-khoan-tien");
    render(<MoneyAccountsPage />);
    await waitFor(() => expect(stub.accounts).toHaveBeenCalledExactlyOnceWith(branch));
    expect(stub.workspace).not.toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Danh sách tài khoản" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("button", { name: "Xuất Excel" })).not.toBeInTheDocument();
  });
});
