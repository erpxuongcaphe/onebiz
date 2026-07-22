import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStockMovementsTab } from "@/components/shared/product-stock-movements-tab";
import { getStockCard } from "@/lib/services";
import { exportToExcel } from "@/lib/utils/export";

vi.mock("@/lib/services", () => ({
  getStockCard: vi.fn(),
}));

vi.mock("@/lib/utils/export", () => ({
  exportToExcel: vi.fn(),
}));

vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: vi.fn() }),
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
    vi.clearAllMocks();
    vi.mocked(exportToExcel).mockResolvedValue(undefined);
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
        productCode="SP-001"
        productName="Sản phẩm A"
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
      <ProductStockMovementsTab
        productId="product-1"
        productCode="SP-001"
        productName="Sản phẩm A"
        canViewCost={false}
      />,
    );

    await waitFor(() => {
      expect(getStockCard).toHaveBeenCalledWith("product-1", undefined);
    });
    expect(await screen.findByText("Chi nhánh")).toBeInTheDocument();
    expect(screen.getByText("Chi nhánh A")).toBeInTheDocument();
    expect(screen.queryByText("Đơn giá")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel thẻ kho" }));
    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledTimes(1);
    });
    const [, columns] = vi.mocked(exportToExcel).mock.calls[0];
    expect(columns.map((column) => column.header)).not.toContain("Đơn giá");
    expect(columns.map((column) => column.header)).not.toContain("Giá trị");
  });

  it("exports the complete stock card with an explicit file name", async () => {
    render(
      <ProductStockMovementsTab
        productId="product-1"
        productCode="SP-001"
        productName="Sản phẩm A"
        branchId="branch-1"
        branchName="Chi nhánh A"
        canViewCost
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Xuất Excel thẻ kho" }));

    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledTimes(1);
    });
    const [rows, columns, fileName] = vi.mocked(exportToExcel).mock.calls[0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productCode: "SP-001",
      productName: "Sản phẩm A",
      scopeName: "Chi nhánh A",
      signedQuantity: 2,
      runningBalance: 7,
    });
    expect(columns.map((column) => column.header)).toContain("Mã phiếu");
    expect(columns.map((column) => column.header)).toContain("Đơn giá");
    expect(fileName).toMatch(/^the-kho_SP-001_chi-nhanh-a_/);
  });
});
