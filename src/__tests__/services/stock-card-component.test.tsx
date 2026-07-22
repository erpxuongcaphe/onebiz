import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStockMovementsTab } from "@/components/shared/product-stock-movements-tab";
import { getStockCard } from "@/lib/services";

vi.mock("@/lib/services", () => ({
  getStockCard: vi.fn(),
}));

const movement = {
  id: "movement-1",
  code: "PN0001",
  type: "import" as const,
  typeName: "Nhập kho",
  quantity: 2,
  costPrice: 0,
  totalAmount: 0,
  date: "2026-07-22T08:00:00.000Z",
  createdBy: "user-1",
  branchId: "branch-1",
  branchName: "Chi nhánh A",
  runningBalance: 7,
  unitPrice: 12000,
};

describe("ProductStockMovementsTab branch scope", () => {
  beforeEach(() => {
    vi.mocked(getStockCard).mockResolvedValue({
      data: [movement],
      total: 1,
      systemStock: 7,
      computedFinal: 7,
      drift: 0,
    });
  });

  it("loads the selected branch and hides the redundant branch column", async () => {
    render(
      <ProductStockMovementsTab
        productId="product-1"
        branchId="branch-1"
        branchName="Chi nhánh A"
        canViewCost
      />,
    );

    await waitFor(() => {
      expect(getStockCard).toHaveBeenCalledWith("product-1", "branch-1");
    });
    expect(await screen.findByText(/tại Chi nhánh A/)).toBeInTheDocument();
    expect(screen.queryByText("Chi nhánh")).not.toBeInTheDocument();
    expect(screen.getByText("Đơn giá")).toBeInTheDocument();
    expect(screen.getByText("Tồn cuối")).toBeInTheDocument();
  });

  it("shows branch context in all-chain mode without leaking cost", async () => {
    render(
      <ProductStockMovementsTab productId="product-1" canViewCost={false} />,
    );

    await waitFor(() => {
      expect(getStockCard).toHaveBeenCalledWith("product-1", undefined);
    });
    expect(await screen.findByText("Chi nhánh")).toBeInTheDocument();
    expect(screen.getByText("Chi nhánh A")).toBeInTheDocument();
    expect(screen.queryByText("Đơn giá")).not.toBeInTheDocument();
  });
});
