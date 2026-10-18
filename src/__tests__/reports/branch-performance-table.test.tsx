import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BranchPerformanceTable } from "@/components/shared/report/branch-performance-table";
import { BRANCH_FIELDS, EMPTY_BRANCH_FILTER, branchPerformanceRows } from "@/lib/reports/branch-performance";
vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich/bao-cao-tai-chinh" }));
afterEach(cleanup);
function Fixture() {
  const [filter, setFilter] = useState(EMPTY_BRANCH_FILTER);
  const [sort, setSort] = useState({ id: "goodsRevenue", direction: "desc" as "asc" | "desc" });
  const rows = branchPerformanceRows([{ branchId: "b1", branchName: "Xưởng", branchType: "factory", revenue: 1000, goodsRevenue: 1000, totalRevenue: 1020, deliveryFee: 20, cogs: 600, grossProfit: 400, grossMargin: 40, opEx: 100, otherIncome: 0, netProfit: 300, netMargin: 30, cogsComplete: true, missingCostLines: 0 }], filter, sort);
  return <BranchPerformanceTable rows={rows} filter={filter} onFilter={setFilter} sort={sort} onSort={setSort} types={[{ value: "factory", label: "Xưởng rang" }]} range={{ from: "2026-10-01", to: "2026-10-18" }} />;
}
describe("branch table complete controls", () => {
  it("renders and sorts every supplied indicator with scoped branch drilldown", () => {
    render(<Fixture />);
    for (const field of BRANCH_FIELDS) expect(screen.getByRole("button", { name: new RegExp(`Sắp xếp ${field.label.replace(/[()]/g, "\\$&")}`) })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Xưởng" });
    expect(link.getAttribute("href")).toContain("branch=b1");
    expect(link.getAttribute("href")).toContain("from=2026-10-01");
    fireEvent.click(screen.getByRole("button", { name: "Sắp xếp Kết quả vận hành tăng dần" }));
    expect(screen.getByRole("button", { name: "Sắp xếp Kết quả vận hành giảm dần" })).toBeInTheDocument();
  });
  it("combines metric filters, rejects invalid ranges and resets without a blocking popup", () => {
    render(<Fixture />);
    fireEvent.click(screen.getByText("Lọc chỉ tiêu"));
    fireEvent.click(screen.getByRole("button", { name: "Thêm điều kiện" }));
    fireEvent.change(screen.getByLabelText("Chỉ tiêu 1"), { target: { value: "netProfit" } });
    fireEvent.change(screen.getByLabelText("Từ giá trị 1"), { target: { value: "400" } });
    expect(screen.getByText("Không có chi nhánh phù hợp.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Đến giá trị 1"), { target: { value: "100" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Khoảng giá trị không hợp lệ");
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc chi nhánh" }));
    expect(screen.getByRole("link", { name: "Xưởng" })).toBeInTheDocument();
  });
});
