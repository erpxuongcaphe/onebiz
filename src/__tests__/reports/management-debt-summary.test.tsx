import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ManagementDebtSummary, managementDebtLink, managementDebtSnapshot } from "@/components/shared/report/management-debt-summary";
import type { DebtPartyRow, DebtWorkspace } from "@/lib/services/supabase/debt-workspace";

afterEach(cleanup);
const party = (id: string, debt: number, advance: number): DebtPartyRow => ({
  id, code: id, name: id, debt, advance, netBalance: debt - advance,
  documentCount: debt > 0 ? 1 : 0, ageDays: 5, bucket: "0-30 ngày", type: "supplier",
  ageBuckets: { bucket0_30: debt, bucket31_60: 0, bucket61_90: 0, bucket91Plus: 0 },
});
const workspace = { receivables: [], payables: [party("a", 630000, 4457009), party("b", 1000000, 0)] } as unknown as DebtWorkspace;

describe("dashboard debt evidence", () => {
  it("keeps advances separate and only matches within the same party", () => {
    const snapshot = managementDebtSnapshot(workspace);
    expect(snapshot.payable.debt).toBe(1630000);
    expect(snapshot.payable.advance).toBe(4457009);
    expect(snapshot.payable.availableOffset).toBe(630000);
  });
  it("opens the exact current balance review without a historical cutoff", () => {
    expect(managementDebtLink("b1", "payable", "both")).toBe("/phan-tich/cong-no-aging?branch=b1&debtMode=payable&debtReview=both&view=table");
    render(<ManagementDebtSummary workspace={workspace} error={null} branchId="b1" />);
    expect(screen.getByText(/không phải cuối kỳ đã chọn/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Đối chiếu tiền ứng/ })).toHaveAttribute("href", managementDebtLink("b1", "payable", "both"));
  });
  it("does not show a false zero or stale figures after failure", () => {
    render(<ManagementDebtSummary workspace={workspace} error="Failed" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Phải trả nhà cung cấp")).not.toBeInTheDocument();
  });
  it("does not call missing age data zero or overdue", () => {
    render(<ManagementDebtSummary workspace={{ ...workspace, payables: [{ ...party("c", 100, 0), ageBuckets: undefined }] }} error={null} />);
    expect(screen.getByText(/Chưa đủ phân tuổi/)).toBeInTheDocument();
    expect(screen.getByText(/tuổi nợ không đồng nghĩa quá hạn/)).toBeInTheDocument();
  });
});
