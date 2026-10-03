import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateProductionOrderDialog } from "@/components/shared/dialogs/create-production-order-dialog";

const mocks = vi.hoisted(() => ({
  activeBranchId: "xtb" as string | undefined,
  boms: [] as Record<string, unknown>[],
  available: 0,
  costedQuantity: null as number | null,
  physicalQuantity: null as number | null,
  prepared: true,
  stockUnit: "" as string,
  unit: "" as string,
  scopeEnabled: true,
  createProductionOrder: vi.fn(),
  completeProductionAtomic: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: mocks.toast }),
  useBranchFilter: () => ({ activeBranchId: mocks.activeBranchId }),
}));
vi.mock("@/lib/services", () => ({
  getAllBOMs: async () => mocks.boms,
  getBOMsByProduct: async () => mocks.boms,
  getBOMById: async () => mocks.boms[0],
  getProductById: async () => ({ isFnbStockItem: mocks.prepared, stockUnit: mocks.stockUnit, unit: mocks.unit }),
  checkMaterialsAvailability: async () => [{ productId: "ingredient", available: mocks.available }],
  createProductionOrder: mocks.createProductionOrder,
  completeProductionAtomic: mocks.completeProductionAtomic,
  getBranches: async () => [
    { id: "warehouse", name: "Kho Tổng", branchType: "factory" },
    { id: "xtb", name: "Xưởng Tư Búa", branchType: "store" },
  ],
}));
vi.mock("@/lib/services/supabase/fnb-supply-catalog", () => ({
  getFnbSupplyBranchScope: async () => ({ enforcementEnabled: mocks.scopeEnabled }),
}));
vi.mock("@/lib/services/supabase/fnb-branch-cost", () => ({
  getFnbBranchComponentCosts: async () => new Map(mocks.costedQuantity === null ? [] : [[
    "ingredient", { productId: "ingredient", costedQuantity: mocks.costedQuantity,
      physicalQuantity: mocks.physicalQuantity ?? mocks.available, unitCost: 10000 },
  ]]),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string | null; onValueChange: (value: string) => void; children: React.ReactNode }) => (
    <select value={value ?? ""} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => <option value="">Chọn chi nhánh...</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    void variant;
    return <button {...props}>{children}</button>;
  },
}));
vi.mock("@/components/ui/icon", () => ({ Icon: () => <span /> }));

describe("production branch selection", () => {
  function selectPreparedProduct() {
    fireEvent.focus(screen.getByPlaceholderText("Gõ mã hoặc tên sản phẩm..."));
    fireEvent.click(screen.getByRole("button", { name: /SKU-BTP-TEST/ }));
    return screen.getByRole("button", { name: "Hoàn thành sản xuất & nhập kho" });
  }

  afterEach(() => {
    cleanup();
    mocks.boms = [];
    mocks.available = 0;
    mocks.costedQuantity = null;
    mocks.physicalQuantity = null;
    mocks.prepared = true;
    mocks.stockUnit = "";
    mocks.unit = "";
    mocks.scopeEnabled = true;
    mocks.createProductionOrder.mockClear();
    mocks.completeProductionAtomic.mockClear();
  });

  it("defaults to the branch currently open, not the first factory", async () => {
    mocks.activeBranchId = "xtb";
    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("xtb"));
  });

  it("requires an explicit branch if the current scope has no branch", async () => {
    mocks.activeBranchId = undefined;
    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(""));
  });

  it("does not create an unfinished order when the selected branch lacks ingredients", async () => {
    mocks.activeBranchId = "xtb";
    mocks.boms = [{
      id: "bom", productId: "prepared", productCode: "SKU-BTP-TEST",
      productName: "Thạch thử", name: "Công thức thạch", isActive: true,
      yieldQty: 1, yieldUnit: "G", items: [{
        materialId: "ingredient", materialCode: "SKU-ING-TEST",
        materialName: "Bột thử", quantity: 1, unit: "G",
      }],
    }];

    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("xtb"));
    const finish = selectPreparedProduct();
    await waitFor(() => expect(screen.getByText(/Thiếu nguyên liệu tại chi nhánh này/)).toBeTruthy());
    expect(finish).toBeDisabled();
    expect(mocks.createProductionOrder).not.toHaveBeenCalled();

    mocks.available = 2;
    mocks.costedQuantity = 2;
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    await waitFor(() => expect(finish).toBeEnabled());
    expect(mocks.createProductionOrder).not.toHaveBeenCalled();
  });

  it("blocks an F&B batch when physical stock lacks matching branch cost", async () => {
    mocks.activeBranchId = "xtb";
    mocks.available = 2;
    mocks.boms = [{
      id: "bom", productId: "prepared", productCode: "SKU-BTP-TEST",
      productName: "Thạch thử", name: "Công thức thạch", isActive: true,
      yieldQty: 1, yieldUnit: "G", items: [{
        materialId: "ingredient", materialCode: "SKU-ING-TEST",
        materialName: "Bột thử", quantity: 1, unit: "G",
      }],
    }];
    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("xtb"));
    const finish = selectPreparedProduct();

    await waitFor(() => expect(screen.getByText(/Tồn và sổ giá vốn F&B tại chi nhánh chưa khớp/)).toBeTruthy());
    expect(finish).toBeDisabled();
    expect(mocks.createProductionOrder).not.toHaveBeenCalled();

    mocks.costedQuantity = 1;
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    await waitFor(() => expect(finish).toBeDisabled());

    mocks.costedQuantity = 2;
    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "1" } });
    await waitFor(() => expect(finish).toBeEnabled());

    mocks.physicalQuantity = 0;
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    await waitFor(() => expect(finish).toBeDisabled());
  });

  it("keeps the Retail production flow independent of the F&B cost ledger", async () => {
    mocks.activeBranchId = "warehouse";
    mocks.prepared = false;
    mocks.available = 2;
    mocks.boms = [{
      id: "bom", productId: "prepared", productCode: "SKU-BTP-TEST",
      productName: "Sản phẩm thử", name: "Công thức thử", isActive: true,
      yieldQty: 1, yieldUnit: "G", items: [{
        materialId: "ingredient", materialCode: "SKU-ING-TEST",
        materialName: "Nguyên liệu thử", quantity: 1, unit: "G",
      }],
    }];
    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("warehouse"));
    const finish = selectPreparedProduct();
    await waitFor(() => expect(finish).toBeEnabled());
  });

  it.each([
    [true, "Mẻ/100g", "G", "Mẻ/100g"],
    [true, "", "G", "G"],
    [false, "Kg", "Kg", "cái"],
  ])("labels output in stock units only for F&B prepared goods (%s, %s)", async (prepared, stockUnit, unit, expectedUnit) => {
    mocks.activeBranchId = "xtb";
    mocks.prepared = prepared;
    mocks.stockUnit = stockUnit;
    mocks.unit = unit;
    mocks.available = 2;
    mocks.costedQuantity = 2;
    mocks.boms = [{
      id: "bom", productId: "prepared", productCode: "SKU-BTP-TEST",
      productName: "Cold Brew thử", name: "Công thức thử", isActive: true,
      yieldQty: 1, yieldUnit: "cái", items: [{
        materialId: "ingredient", materialCode: "SKU-ING-TEST",
        materialName: "Cà phê thử", quantity: 0.2, unit: "Túi",
      }],
    }];
    mocks.createProductionOrder.mockResolvedValue({ id: "order", code: "SX-UAT" });
    mocks.completeProductionAtomic.mockResolvedValue("lot");
    render(<CreateProductionOrderDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("xtb"));
    const finish = selectPreparedProduct();
    await waitFor(() => expect(finish).toBeEnabled());
    expect(screen.getByText(expectedUnit, { exact: true })).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    await waitFor(() => expect(finish).toBeEnabled());
    fireEvent.click(finish);
    await waitFor(() => expect(mocks.completeProductionAtomic).toHaveBeenCalled());
    expect(mocks.createProductionOrder).toHaveBeenCalledWith(expect.objectContaining({
      branchId: "xtb", plannedQty: 2,
      materials: [{ productId: "ingredient", plannedQty: 0.4, unit: "Túi" }],
    }));
    expect(mocks.completeProductionAtomic.mock.calls[0][1]).toBe(2);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sản xuất hoàn thành", description: expect.stringContaining(`2 ${expectedUnit}`),
    }));
  });
});
