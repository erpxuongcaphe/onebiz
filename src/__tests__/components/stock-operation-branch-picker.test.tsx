import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ read: vi.fn(), toast: vi.fn(), scope: {}, canViewCost: false }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/contexts", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/permissions/use-permission", () => ({ usePermissions: () => ({ hasPermission: () => state.canViewCost }) }));
vi.mock("@/lib/hooks/use-fnb-catalog-scope", () => ({ useFnbCatalogScope: () => state.scope }));
vi.mock("@/lib/fnb-catalog-scope", () => ({ applyFnbCatalogScope: (query: unknown) => query }));
vi.mock("@/lib/hooks/use-product-uom", () => ({ useProductUom: () => ({ map: new Map() }) }));
vi.mock("@/lib/services/supabase/product-stock-read", () => ({ getVisibleBranchStock: state.read }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant", branchId: "premium", userId: "user" }),
  getClient: () => ({ from: () => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "or", "eq"]) q[method] = () => q;
    q.limit = async () => ({ data: [{ id: "coffee", code: "CAFE", name: "Cà phê", unit: "kg", cost_price: 5 }], error: null });
    return q;
  } }),
}));
import { CreateDisposalDialog } from "@/components/shared/dialogs/create-disposal-dialog";
import { CreateInternalExportDialog } from "@/components/shared/dialogs/create-internal-export-dialog";

describe("stock operation product picker", () => {
  beforeEach(() => { state.read.mockReset(); state.toast.mockReset(); state.canViewCost = false; });
  afterEach(cleanup);
  it.each([["xuất hủy", CreateDisposalDialog], ["xuất nội bộ", CreateInternalExportDialog]])("does not present masked cost as zero for %s", (_name, Component) => {
    render(<Component open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
  });
  it.each([["xuất hủy", CreateDisposalDialog], ["xuất nội bộ", CreateInternalExportDialog]])("uses the actual branch stock for %s", async (_name, Component) => {
    state.read.mockResolvedValue({ allowed: true, quantities: new Map([["coffee", 3]]) });
    render(<Component open onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("Tìm sản phẩm theo tên hoặc mã");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "cafe" } });
    expect(await screen.findByText(/Tồn 3/)).toBeInTheDocument();
    expect(state.read).toHaveBeenCalledWith("premium", ["coffee"]);
  });
  it.each([["xuất hủy", CreateDisposalDialog], ["xuất nội bộ", CreateInternalExportDialog]])("does not display a fabricated zero when %s stock is denied", async (_name, Component) => {
    state.read.mockResolvedValue({ allowed: false, quantities: new Map() });
    render(<Component open onOpenChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("Tìm sản phẩm theo tên hoặc mã");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "cafe" } });
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không tải được tồn kho" })));
    expect(screen.queryByText(/Tồn 0/)).not.toBeInTheDocument();
  });
});
