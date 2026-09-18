import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "@/app/(main)/hang-hoa/hang-cap-fnb/page";

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), save: vi.fn(), list: vi.fn(), search: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ hasPermission: mocks.permission }), useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/services", () => ({ getBranches: async () => [
  { id: "a", code: "A", name: "Quán A" }, { id: "b", code: "B", name: "Quán B" },
] }));
vi.mock("@/lib/services/supabase/internal-sale-products", () => ({ searchInternalSaleProducts: mocks.search }));
vi.mock("@/lib/services/supabase/fnb-supply-catalog", () => ({ listFnbSupplyCatalog: mocks.list, saveFnbSupplyCatalog: mocks.save }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => <header>{title}<p>{subtitle}</p></header> }));
vi.mock("@/components/ui/icon", () => ({ Icon: () => <span /> }));
vi.mock("@/components/ui/button", () => ({ Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => <button {...props} /> }));
vi.mock("@/components/ui/input", () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));

describe("F&B supply setup screen", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    vi.clearAllMocks();
    mocks.permission.mockReturnValue(true);
    mocks.list.mockResolvedValue({ rows: [], count: 0 });
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
    expect(screen.getByLabelText("Chi nhánh xem cấu hình")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "A · Quán A" })).toBeInTheDocument());
  });

  it("does not replace current-branch results with a late previous request", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    mocks.list.mockImplementation((branch: string) => branch === "a" ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ rows: [], count: 0 }));
    render(<Page />);
    await screen.findByRole("option", { name: "A · Quán A" });
    const selector = screen.getByLabelText("Chi nhánh xem cấu hình");
    fireEvent.change(selector, { target: { value: "a" } });
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    fireEvent.change(selector, { target: { value: "b" } });
    await screen.findByText("Chưa có hàng trong danh sách cấp của chi nhánh này.");
    resolveOld({ rows: [{ product_id: "old", products: { code: "OLD", name: "Old item", unit: "Box", is_active: true } }], count: 1 });
    await waitFor(() => expect(screen.queryByText("OLD")).not.toBeInTheDocument());
  });
});
