import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "@/app/(main)/hang-hoa/hang-cap-fnb/page";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), save: vi.fn(), list: vi.fn(), scope: vi.fn(), setScope: vi.fn(), search: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ hasPermission: mocks.permission }), useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/services", () => ({ getBranches: async () => [
  { id: "a", code: "A", name: "Quán A", branchType: "store" },
  { id: "b", code: "B", name: "Quán B", branchType: "store" },
  { id: "warehouse", code: "KHO", name: "Kho tổng", branchType: "warehouse" },
] }));
vi.mock("@/lib/services/supabase/internal-sale-products", () => ({ searchInternalSaleProducts: mocks.search }));
vi.mock("@/lib/services/supabase/fnb-supply-catalog", () => ({
  listFnbSupplyCatalog: mocks.list, saveFnbSupplyCatalog: mocks.save,
  getFnbSupplyBranchScope: mocks.scope, setFnbSupplyBranchScope: mocks.setScope,
}));
vi.mock("@/components/shared/dialogs/confirm-dialog", () => ({ ConfirmDialog: ({ open, title, onConfirm }: { open: boolean; title: string; onConfirm: () => void }) => open ? <div><p>{title}</p><button onClick={onConfirm}>Xác nhận kiểm soát</button></div> : null }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <header>{title}<p>{subtitle}</p></header> }));
vi.mock("@/components/ui/icon", () => ({ Icon: () => <span /> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant, size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => {
  void variant;
  void size;
  return <button {...props} />;
} }));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));

describe("F&B supply setup screen", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.permission.mockReturnValue(true);
    mocks.list.mockResolvedValue({ rows: [], count: 0 });
    mocks.scope.mockResolvedValue({ enforcementEnabled: false });
    mocks.setScope.mockResolvedValue(true);
    mocks.save.mockResolvedValue(2);
    mocks.search.mockResolvedValue([
      { id: "box", code: "SKU-SUA-001", name: "Sữa hộp", unit: "Hộp" },
      { id: "carton", code: "SKU-SUA-002", name: "Sữa thùng", unit: "Thùng" },
    ]);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("saves the exact selected SKU to multiple branches without substituting packaging", async () => {
    render(<Page />);
    fireEvent.change(screen.getByLabelText("Tìm SKU Retail"), { target: { value: "sữa" } });
    const box = await screen.findByRole("checkbox", { name: /SKU-SUA-001/ });
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("checkbox", { name: "A · Quán A" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "B · Quán B" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm 1 hàng cho 2 chi nhánh" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(["box"], ["a", "b"], "add"));
  });

  it("does not offer editing with product permission alone", async () => {
    mocks.permission.mockImplementation((permission: string) => permission !== "system.manage_branches");
    render(<Page />);
    expect(screen.queryByLabelText("Tìm SKU Retail")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Quán xem cấu hình")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "A · Quán A" })).toBeInTheDocument());
  });

  it("does not replace current-branch results with a late previous request", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.list.mockImplementation((branch: string) => branch === "a" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ rows: [], count: 0 }));
    render(<Page />);
    await screen.findByRole("option", { name: "A · Quán A" });
    const selector = screen.getByLabelText("Quán xem cấu hình");
    fireEvent.change(selector, { target: { value: "a" } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.change(selector, { target: { value: "b" } });
    await screen.findByText("Chưa có hàng trong danh sách cấp của chi nhánh này.");
    resolveOld({ rows: [{ product_id: "old", products: { code: "OLD", name: "Old item", unit: "Box", is_active: true } }], count: 1 });
    await waitFor(() => expect(screen.queryByText("OLD")).not.toBeInTheDocument());
  });

  it("keeps warehouse branches out of the default F&B supply selection", async () => {
    render(<Page />);
    await screen.findByRole("option", { name: "A · Quán A" });
    expect(screen.queryByRole("checkbox", { name: /KHO.*Kho tổng/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /KHO.*Kho tổng/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Hiện chi nhánh khác" })[0]);
    const warehouse = screen.getByRole("checkbox", { name: /KHO.*Kho tổng.*warehouse/ });
    expect(warehouse).toBeInTheDocument();
    fireEvent.click(warehouse);

    fireEvent.click(screen.getAllByRole("button", { name: "Ẩn chi nhánh ngoài quán" })[0]);
    expect(screen.queryByRole("checkbox", { name: /KHO.*Kho tổng/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "A · Quán A" }));
    fireEvent.change(screen.getByLabelText("Tìm SKU Retail"), { target: { value: "sữa" } });
    fireEvent.click(await screen.findByRole("checkbox", { name: /SKU-SUA-001/ }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm 1 hàng cho 1 chi nhánh" }));
    await waitFor(() => expect(mocks.save).toHaveBeenLastCalledWith(["box"], ["a"], "add"));
  });

  it("requires an explicit confirmation before enabling a configured store", async () => {
    mocks.list.mockResolvedValue({ rows: [], count: 1 });
    render(<Page />);
    await screen.findByRole("option", { name: "A · Quán A" });
    fireEvent.change(screen.getByLabelText("Quán xem cấu hình"), { target: { value: "a" } });
    await screen.findByRole("button", { name: "Bật kiểm soát" });

    fireEvent.click(screen.getByRole("button", { name: "Bật kiểm soát" }));
    expect(mocks.setScope).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận kiểm soát" }));
    await waitFor(() => expect(mocks.setScope).toHaveBeenCalledWith("a", true));
  });
});
