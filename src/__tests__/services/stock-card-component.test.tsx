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
  recordedPriceSource: "movement_snapshot" as const,
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

  it("clears a previous branch error and reloads the new scope", async () => {
    vi.mocked(getStockCard).mockRejectedValueOnce(new Error("Old branch unavailable"));
    const { rerender } = render(
      <ProductStockMovementsTab productId="product-1" productCode="SP-001" productName="A" branchId="branch-1" />,
    );
    expect(await screen.findByText("Old branch unavailable")).toBeInTheDocument();
    rerender(
      <ProductStockMovementsTab productId="product-1" productCode="SP-001" productName="A" branchId="branch-2" />,
    );
    expect(screen.queryByText("Old branch unavailable")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Xuất Excel thẻ kho" })).toBeInTheDocument();
    expect(getStockCard).toHaveBeenLastCalledWith("product-1", "branch-2");
  });

  it("hides old scope data while loading and ignores its late response", async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof getStockCard>>) => void;
    vi.mocked(getStockCard).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = render(
      <ProductStockMovementsTab productId="product-old" productCode="OLD" productName="Old" branchId="branch-1" />,
    );
    rerender(
      <ProductStockMovementsTab productId="product-new" productCode="NEW" productName="New" branchId="branch-2" />,
    );
    expect(await screen.findByRole("button", { name: "Xuất Excel thẻ kho" })).toBeInTheDocument();
    resolveOld({ data: [], total: 0, systemStock: 0, computedFinal: 0, drift: 0 });
    await waitFor(() => expect(screen.queryByText("Chưa có biến động kho")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Xuất Excel thẻ kho" })).toBeInTheDocument();
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
    expect(screen.queryByText("Giá dòng kho")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xuất Excel thẻ kho" }));
    await waitFor(() => {
      expect(exportToExcel).toHaveBeenCalledTimes(1);
    });
    const [, columns] = vi.mocked(exportToExcel).mock.calls[0];
    expect(columns.map((column) => column.header)).not.toContain("Đơn giá");
    expect(columns.map((column) => column.header)).not.toContain("Giá trị");
    expect(columns.map((column) => column.header)).not.toContain("Nguồn đơn giá");
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
      priceSourceName: "Giá dòng kho",
    });
    expect(columns.map((column) => column.header)).toContain("Mã phiếu");
    expect(columns.map((column) => column.header)).toContain("Đơn giá");
    expect(columns.map((column) => column.header)).toContain("Nguồn đơn giá");
    expect(fileName).toMatch(/^the-kho_SP-001_chi-nhanh-a_/);
  });

  it("shows the recorded branch ledger source and never labels zero as missing", async () => {
    vi.mocked(getStockCard).mockResolvedValueOnce({
      data: [{ ...movement, unitPrice: 0, unitCost: 0, recordedPriceSource: "branch_cost_ledger" }],
      total: 1, systemStock: 7, computedFinal: 7, drift: 0,
    });
    render(<ProductStockMovementsTab productId="product-1" productCode="SP-001" productName="A" branchId="branch-1" canViewCost />);
    expect(await screen.findByText("Sổ vốn chi nhánh")).toBeInTheDocument();
    expect(screen.queryByText("Chưa có đơn giá")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: "Xuất Excel thẻ kho"}));
    await waitFor(() => expect(exportToExcel).toHaveBeenCalledTimes(1));
    expect(vi.mocked(exportToExcel).mock.calls[0][0][0]).toMatchObject({
      priceSourceName: "Sổ vốn chi nhánh", unitValue: 0, movementValue: 0,
    });
  });
});
