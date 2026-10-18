import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { cashMovementSummary, ManagementCashSummary } from "@/components/shared/report/management-cash-summary";
import type { CashFlowDetailedRow } from "@/lib/services/supabase/analytics";
afterEach(cleanup);

const range = { from: "2026-09-01", to: "2026-10-18" };
const rows = [
  { totalReceipt: 1000, totalPayment: 300 },
  { totalReceipt: 200, totalPayment: 400 },
] as CashFlowDetailedRow[];
describe("management cash summary", () => {
  it("aggregates the same period without treating movement as a closing balance", () => {
    expect(cashMovementSummary(rows)).toEqual({ receipts: 1200, payments: 700, net: 500 });
    render(<ManagementCashSummary rows={rows} error={null} branchId="b1" range={range} />);
    expect(screen.getByText(/không phải số dư quỹ/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dòng tiền" })).toHaveAttribute("href", "/phan-tich/luong-tien?branch=b1&preset=custom&from=2026-09-01&to=2026-10-18&view=table");
  });
  it("does not display a false zero when loading cash fails", () => {
    render(<ManagementCashSummary rows={[]} error="RPC unavailable" range={range} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("0đ")).not.toBeInTheDocument();
  });
});
