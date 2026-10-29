import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), toast: vi.fn(), allowed: true, branch: "branch-a", branches: [{ id: "branch-a", name: "Quán A" }] }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: () => ({ hasPermission: () => m.allowed }) }));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: m.toast }), useBranchFilter: () => ({ activeBranchId: m.branch }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ branches: m.branches }) }));
vi.mock("@/lib/hooks/use-fnb-catalog-scope", () => ({ useFnbCatalogScope: () => true }));
vi.mock("@/lib/services/supabase/fnb-branch-cost", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/services/supabase/fnb-branch-cost")>(), getFnbBranchComponentCosts: m.read }));
vi.mock("@/lib/services", () => ({
  createBOM: m.save, updateBOM: m.save,
  getProducts: async () => ({ data: [{ id: "drink", name: "Món thử", code: "SKU-TEST", productType: "sku", channel: "fnb", unit: "Ly" }] }),
  getBOMById: async () => ({ productId: "drink", branchId: "branch-a", name: "Công thức thử", batchSize: 1, yieldQty: 1, yieldUnit: "Ly", items: [{ materialId: "milk", materialName: "Sữa thử", materialCode: "SKU-MILK", quantity: 2, unit: "G", materialCostPrice: 9999 }] }),
  getUOMConversions: async () => [], listBOMModifierOptionQuantities: async () => [], saveBOMModifierOptionQuantities: vi.fn(),
}));
vi.mock("@/lib/services/supabase/modifier-groups", () => ({ listModifierGroups: async () => [], getEffectiveModifierGroupsForProduct: async () => [], listModifierOptions: async () => [] }));
import { BOMEditorDialog } from "@/components/shared/dialogs/bom-editor-dialog";
import { formatCurrency } from "@/lib/format";
beforeEach(() => { vi.clearAllMocks(); m.allowed = true; m.branch = "branch-a"; });
afterEach(cleanup);

it("shows loading, load failure and successful retry without altering the recipe", async () => {
  let reject!: (error: Error) => void;
  m.read.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValueOnce(new Map([["milk", { productId: "milk", unitCost: 10, costedQuantity: 100, physicalQuantity: 100 }]]));
  render(<BOMEditorDialog open bomId="bom" onOpenChange={vi.fn()} />);
  await waitFor(() => expect(m.read).toHaveBeenCalledOnce());
  expect(screen.getByText("Đang tải giá vốn...")).toBeInTheDocument();
  expect(screen.queryByText("Chưa đủ giá vốn chi nhánh")).not.toBeInTheDocument();
  await act(async () => reject(new Error("network detail")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được giá vốn chi nhánh.");
  expect(screen.queryByText("Chưa đủ giá vốn chi nhánh")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Thử lại/ }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect((await screen.findAllByText(formatCurrency(20))).length).toBeGreaterThan(0);
  expect(m.read.mock.calls[1][0]).toBe("branch-a"); expect(m.save).not.toHaveBeenCalled();
});

it("a successful empty response is missing cost, not an error or a zero-priced total", async () => {
  m.read.mockResolvedValue(new Map());
  render(<BOMEditorDialog open bomId="bom" onOpenChange={vi.fn()} />);
  expect(await screen.findByText("Chưa đủ giá vốn chi nhánh")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("0đ")).not.toBeInTheDocument(); expect(m.save).not.toHaveBeenCalled();
});

it("never requests or displays cost for a user without the cost permission", async () => {
  m.allowed = false;
  render(<BOMEditorDialog open bomId="bom" onOpenChange={vi.fn()} />);
  await screen.findByDisplayValue("Công thức thử");
  expect(m.read).not.toHaveBeenCalled(); expect(screen.queryByText(/Dự toán \/ mẻ/)).not.toBeInTheDocument();
});
