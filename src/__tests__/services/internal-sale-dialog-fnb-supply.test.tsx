import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreateInternalSaleDialog } from "@/components/shared/dialogs/create-internal-sale-dialog";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  search: vi.fn(),
  scope: vi.fn(),
  catalog: vi.fn(),
  create: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: mocks.toast }),
  useAuth: () => ({ user: { tenantId: "tenant" } }),
}));
vi.mock("@/lib/services", () => ({
  getBranches: async () => [
    { id: "warehouse", name: "Kho Tổng" },
    { id: "xtb", name: "Xưởng Tư Búa" },
    { id: "other", name: "Quán khác" },
  ],
  createInternalSale: mocks.create,
  syncInternalEntities: mocks.sync,
}));
vi.mock("@/lib/services/supabase/internal-sale-products", () => ({
  searchInternalSaleProducts: mocks.search,
}));
vi.mock("@/lib/services/supabase/fnb-supply-catalog", () => ({
  getFnbSupplyBranchScope: mocks.scope,
  listFnbSupplyCatalogProductIds: mocks.catalog,
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
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock("@/components/ui/numeric-input", () => ({
  NumericInput: ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (
    <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
  ),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => {
    const { variant, ...buttonProps } = props;
    void variant;
    return <button {...buttonProps}>{children}</button>;
  },
}));
vi.mock("@/components/ui/icon", () => ({ Icon: () => <span /> }));

const product = {
  id: "honey", code: "SKU-SST-018", name: "Mật ong", unit: "Chai", sell_price: 250000, vat_rate: 0,
};

async function selectRoute(receiver = "xtb") {
  const selectors = await screen.findAllByRole("combobox");
  fireEvent.change(selectors[0], { target: { value: "warehouse" } });
  fireEvent.change(selectors[1], { target: { value: receiver } });
  await waitFor(() => expect(mocks.catalog).toHaveBeenCalledWith(receiver, expect.any(AbortSignal)));
  await screen.findByText(/chỉ tìm trong 1 mã đã duyệt/);
}

describe("internal sale dialog for an F&B destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ enforcementEnabled: true });
    mocks.catalog.mockResolvedValue(["honey"]);
    mocks.search.mockResolvedValue([product]);
    mocks.create.mockResolvedValue({ code: "BNB-UAT" });
    mocks.sync.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it("sends the approved Retail SKU and its sell price to the internal-sale service", async () => {
    render(<CreateInternalSaleDialog open onOpenChange={vi.fn()} />);
    await selectRoute();
    fireEvent.change(screen.getByPlaceholderText("Tìm sản phẩm theo tên hoặc mã..."), { target: { value: product.code } });
    fireEvent.click(await screen.findByRole("button", { name: /SKU-SST-018.*Mật ong/ }));
    fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "debt" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo đơn nội bộ" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      fromBranchId: "warehouse", toBranchId: "xtb", paymentMethod: "debt", note: undefined,
      items: [{
        productId: "honey", productCode: product.code, productName: product.name,
        unit: "Chai", quantity: 1, unitPrice: 250000, vatRate: 0,
      }],
    }));
    expect(mocks.search).toHaveBeenCalledWith(product.code, expect.any(AbortSignal), false, ["honey"]);
  });

  it("does not search or create a sale when the destination catalog cannot be checked", async () => {
    mocks.scope.mockRejectedValue(new Error("catalog unavailable"));
    render(<CreateInternalSaleDialog open onOpenChange={vi.fn()} />);
    const selectors = await screen.findAllByRole("combobox");
    fireEvent.change(selectors[0], { target: { value: "warehouse" } });
    fireEvent.change(selectors[1], { target: { value: "xtb" } });
    await screen.findByRole("alert");
    expect(screen.getByPlaceholderText("Tìm sản phẩm theo tên hoặc mã...")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tạo đơn nội bộ" }));
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an item already selected when the receiving branch no longer approves it", async () => {
    mocks.catalog.mockImplementation(async (branchId: string) => branchId === "xtb" ? ["honey"] : ["other-product"]);
    render(<CreateInternalSaleDialog open onOpenChange={vi.fn()} />);
    await selectRoute();
    fireEvent.change(screen.getByPlaceholderText("Tìm sản phẩm theo tên hoặc mã..."), { target: { value: product.code } });
    fireEvent.click(await screen.findByRole("button", { name: /SKU-SST-018.*Mật ong/ }));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "other" } });
    await screen.findByText(/chỉ tìm trong 1 mã đã duyệt/);
    fireEvent.click(screen.getByRole("button", { name: "Tạo đơn nội bộ" }));
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Có SKU chưa được duyệt cấp cho quán này", variant: "error",
    }));
  });
});
