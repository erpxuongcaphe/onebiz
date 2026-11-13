import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartyDirectoryMetricScope } from "@/components/shared/party-directory-metric-scope";

describe("party directory metric scope", () => {
  it("names the branches separately for activity and debt", () => {
    render(<PartyDirectoryMetricScope kind="customer"
      branches={[{ id: "a", name: "Premium" }, { id: "b", name: "Tư Búa" }]}
      scope={{ scope: "assigned", branchIds: ["a", "b"], activityBranchIds: ["b"], debtBranchIds: ["a"] }} />);
    expect(screen.getByText(/Doanh số khách hàng:/).parentElement).toHaveTextContent("Chỉ Tư Búa");
    expect(screen.getByText(/Công nợ:/).parentElement).toHaveTextContent("Chỉ Premium");
    expect(screen.getByText(/Mỗi số liệu và tổng chỉ tính/)).toBeVisible();
  });
  it("shows a missing permission and never guesses an unknown branch name", () => {
    render(<PartyDirectoryMetricScope kind="supplier" branches={[]}
      scope={{ scope: "company", branchIds: ["a", "b"], activityBranchIds: ["a"], debtBranchIds: [] }} />);
    expect(screen.getByText(/Tổng mua nhà cung cấp:/).parentElement).toHaveTextContent("1 chi nhánh được cấp");
    expect(screen.getByText(/Công nợ:/).parentElement).toHaveTextContent("Chưa được cấp");
  });
});
