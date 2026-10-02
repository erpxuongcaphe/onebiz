import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateProductionOrderDialog } from "@/components/shared/dialogs/create-production-order-dialog";

const mocks = vi.hoisted(() => ({
  activeBranchId: "xtb" as string | undefined,
  boms: [] as Record<string, unknown>[],
  available: 0,
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
  checkMaterialsAvailability: async () => [{ productId: "ingredient", available: mocks.available }],
  createProductionOrder: mocks.createProductionOrder,
  completeProductionAtomic: mocks.completeProductionAtomic,
  getBranches: async () => [
    { id: "warehouse", name: "Kho Tổng", branchType: "factory" },
    { id: "xtb", name: "Xưởng Tư Búa", branchType: "store" },
  ],
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
  afterEach(() => {
    cleanup();
    mocks.boms = [];
    mocks.available = 0;
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
    fireEvent.focus(screen.getByPlaceholderText("Gõ mã hoặc tên sản phẩm..."));
    fireEvent.click(screen.getByRole("button", { name: /SKU-BTP-TEST/ }));

    const finish = screen.getByRole("button", { name: "Hoàn thành sản xuất & nhập kho" });
    await waitFor(() => expect(screen.getByText(/Thiếu nguyên liệu tại chi nhánh này/)).toBeTruthy());
    expect(finish).toBeDisabled();
    expect(mocks.createProductionOrder).not.toHaveBeenCalled();

    mocks.available = 2;
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } });
    await waitFor(() => expect(finish).toBeEnabled());
    expect(mocks.createProductionOrder).not.toHaveBeenCalled();
  });
});
