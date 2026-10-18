import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagementReview } from "@/components/shared/report/management-review";
import type { ProfitAndLoss } from "@/lib/services/supabase/reports";

vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich" }));
afterEach(cleanup);
const pnl: ProfitAndLoss = {
  period: "2026-09", revenue: 1000, goodsRevenue: 1000, deliveryFee: 0,
  cogs: 400, cogsComplete: true, missingCostLines: 0, grossProfit: 600,
  grossMargin: 60, operatingExpense: 200, otherIncome: 50, netProfit: 450, netMargin: 45,
};
const props = {
  current: pnl, previous: pnl,
  range: { from: "2026-09-01", to: "2026-09-30" },
  updatedAt: "2026-10-18T06:00:00Z",
};

describe("management review interface", () => {
  it("reveals numeric evidence and keeps drilldown scope", () => {
    render(<ManagementReview {...props} branchId="branch-1" />);
    expect(screen.queryByLabelText("Bằng chứng biến động")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem bằng chứng" }));
    expect(screen.getByLabelText("Bằng chứng biến động")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thu gọn" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /Dòng tiền/ })).toHaveAttribute("href", "/phan-tich/luong-tien?branch=branch-1&preset=custom&from=2026-09-01&to=2026-09-30&view=table");
    expect(screen.queryByText("Đóng góp chi nhánh")).not.toBeInTheDocument();
  });

  it("shows incomplete-cost warning and branch failures without zero substitution", () => {
    render(<ManagementReview {...props} current={{ ...pnl, cogsComplete: false, missingCostLines: 3 }} branchError="Không thể tải chi nhánh" />);
    expect(screen.getByRole("heading", { name: "Chưa đủ giá vốn" })).toBeInTheDocument();
    expect(screen.getAllByText("Chưa đủ giá vốn").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent("Không thể tải chi nhánh");
  });
});
