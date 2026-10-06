import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ branches: vi.fn(), stations: vi.fn(), toast: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/contexts", () => ({
  useAuth: () => ({ currentBranch: { id: "warehouse", name: "Kho Tổng" } }),
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ settings: { print: { backend: "browser" } } }) }));
vi.mock("@/lib/services/supabase/branches", () => ({ getBranches: mocks.branches }));
vi.mock("@/lib/services/supabase/kitchen-stations", () => ({
  getKitchenStationsByBranch: mocks.stations,
  createKitchenStation: mocks.create, updateKitchenStation: vi.fn(), deleteKitchenStation: vi.fn(),
}));
vi.mock("@/components/shared/bridge-printer-setup", () => ({ BridgePrinterSetup: () => null }));
import { KitchenStationsCard } from "@/components/shared/kitchen-stations-card";

const branches = [
  { id: "warehouse", name: "Kho Tổng", branchType: "warehouse" },
  { id: "a", code: "A", name: "Quán A", branchType: "store" },
  { id: "b", code: "B", name: "Quán B", branchType: "store" },
];
beforeEach(() => { vi.clearAllMocks(); mocks.branches.mockResolvedValue(branches); mocks.stations.mockResolvedValue([]); });

describe("phạm vi trạm chế biến nhìn thấy", () => {
  it("không hiện quán đầu tiên khi phạm vi thực là kho và yêu cầu chọn trước khi tạo", async () => {
    render(<KitchenStationsCard />);
    const select = await screen.findByRole("combobox", { name: "Chi nhánh trạm chế biến" });
    expect(select).toHaveValue("");
    expect(screen.getByRole("button", { name: "Tạo trạm đầu tiên" })).toBeDisabled();
    expect(mocks.stations).not.toHaveBeenCalled();
    fireEvent.change(select, { target: { value: "a" } });
    await waitFor(() => expect(mocks.stations).toHaveBeenCalledWith("a"));
    expect(screen.getByText("Chi nhánh: Quán A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo trạm đầu tiên" })).toBeEnabled();
  });
  it("đổi chi nhánh theo ngữ cảnh và bỏ phản hồi muộn của quán cũ", async () => {
    let finishA!: (data: unknown[]) => void;
    mocks.stations.mockImplementation((id: string) => id === "a" ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve([]));
    const { rerender } = render(<KitchenStationsCard branchId="a" />);
    await waitFor(() => expect(mocks.stations).toHaveBeenCalledWith("a"));
    rerender(<KitchenStationsCard branchId="b" />);
    await waitFor(() => expect(mocks.stations).toHaveBeenCalledWith("b"));
    await act(async () => finishA([{ id: "old", branchId: "a", name: "Bar cũ", color: "#2563eb", icon: "local_cafe", sortOrder: 1, settings: {} }]));
    expect(screen.getByRole("combobox", { name: "Chi nhánh trạm chế biến" })).toHaveValue("b");
    expect(screen.queryByText("Bar cũ")).not.toBeInTheDocument();
  });
  it("hiện chi nhánh trong hộp tạo trạm và đóng không ghi dữ liệu", async () => {
    render(<KitchenStationsCard branchId="a" />);
    await waitFor(() => expect(mocks.stations).toHaveBeenCalledWith("a"));
    fireEvent.click(screen.getByRole("button", { name: "Tạo trạm đầu tiên" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Chi nhánh: Quán A");
    expect(screen.getByRole("textbox", { name: "Tên trạm" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Tự động in phiếu" })).toBeChecked();
    fireEvent.click(screen.getByRole("switch", { name: "Tự động in phiếu" }));
    expect(screen.getByRole("switch", { name: "Tự động in phiếu" })).not.toBeChecked();
    fireEvent.click(screen.getAllByRole("button", { name: "Đóng" })[0]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mocks.create).not.toHaveBeenCalled();
  });

});
