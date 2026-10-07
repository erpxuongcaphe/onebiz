import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), conversions: vi.fn(), toast: vi.fn(),
  auth: { currentBranch: { branchType: "store" }, branches: [], activeBranchId: "xtb" },
}));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => mocks.auth,
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/services/supabase/uom", () => ({ getUOMConversions: mocks.conversions }));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentContext: async () => ({ tenantId: "tenant", branchId: "xtb" }),
  getClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        or: () => query,
        limit: async () => ({ data: [{ id: "milk", code: "SUA", name: "Sữa", unit: "Lon", cost_price: 28000 }], error: null }),
        is: async () => ({ data: table === "branch_stock" ? [{ quantity: 24.5 }] : [], error: null }),
      };
      return query;
    },
  }),
}));

import { CreateInventoryCheckDialog } from "@/components/shared/dialogs/create-inventory-check-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.conversions.mockResolvedValue([
    { fromUnit: "Thùng", toUnit: "Lon", factor: 12, isActive: true },
    { fromUnit: "Lon", toUnit: "G", factor: 1000, isActive: true },
  ]);
  mocks.rpc.mockResolvedValue({ data: { check_id: "check", code: "KK1", status: "balanced" }, error: null });
});
afterEach(cleanup);

async function addMilk() {
  render(<CreateInventoryCheckDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Tìm theo mã, tên hoặc barcode"), { target: { value: "SUA" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sữa.*SUA.*Thêm/ }));
  await screen.findByRole("combobox", { name: "Đơn vị kiểm Sữa" });
}

it("preserves the count on unit changes and posts grams in canonical units once", async () => {
  await addMilk();
  expect(screen.getByLabelText("Số Thùng Sữa")).toHaveValue("2");
  expect(screen.getByLabelText("Số lẻ Sữa")).toHaveValue("0.5");
  fireEvent.click(screen.getByRole("combobox", { name: "Đơn vị kiểm Sữa" }));
  const gramsOption = await screen.findByRole("option", { name: "G" });
  fireEvent.focus(gramsOption);
  fireEvent.click(gramsOption);
  const input = await screen.findByLabelText("Tồn thực tế Sữa");
  expect(input).toHaveValue("24,500");
  fireEvent.change(input, { target: { value: "500" } });
  fireEvent.blur(input);
  fireEvent.click(screen.getByRole("button", { name: "Hoàn thành kiểm kho" }));
  await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(1));
  expect(mocks.rpc).toHaveBeenCalledWith("create_and_apply_inventory_check_atomic", {
    p_branch_id: "xtb", p_note: null, p_items: [{ product_id: "milk", actual_stock: 0.5 }],
  });
}, 15_000);

it("does not silently fall back to a stock unit when conversions fail to load", async () => {
  mocks.conversions.mockRejectedValue(new Error("network"));
  render(<CreateInventoryCheckDialog open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Tìm theo mã, tên hoặc barcode"), { target: { value: "SUA" } });
  fireEvent.click(await screen.findByRole("button", { name: /Sữa.*SUA.*Thêm/ }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Không tải được đơn vị quy đổi" })));
  expect(screen.queryByRole("combobox", { name: "Đơn vị kiểm Sữa" })).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
}, 15_000);
