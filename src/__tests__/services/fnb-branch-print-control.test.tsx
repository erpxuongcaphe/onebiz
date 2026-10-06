import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
const mock = vi.hoisted(() => ({ state: vi.fn(), update: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ settings: { print: { backend: "qz-tray", fnbBranchQueue: false, autoPrintKitchen: true, autoPrintReceipt: false } }, updateSettings: mock.update }) }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/printer/branch-queue", () => ({ getBranchPrintState: mock.state }));
import { FnbBranchPrintControl } from "@/components/shared/fnb-branch-print-control";
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
describe("personal-phone branch print selection", () => {
  it("lets staff select kitchen and receipt triggers independently", async () => {
    mock.state.mockResolvedValue({ point: null, jobs: [] });
    render(<FnbBranchPrintControl branchId="branch" />);
    fireEvent.click(screen.getByRole("button", { name: "Nơi nhận & lệnh in" }));
    const kitchen = screen.getByRole("checkbox", { name: /In bếp khi bấm Gửi bếp/ });
    const receipt = screen.getByRole("checkbox", { name: /In bill sau thanh toán thành công/ });
    expect(kitchen).toBeChecked();
    expect(receipt).not.toBeChecked();
    fireEvent.click(receipt);
    expect(mock.update).toHaveBeenCalledWith("print", { autoPrintReceipt: true });
    fireEvent.click(kitchen);
    expect(mock.update).toHaveBeenCalledWith("print", { autoPrintKitchen: false });
  });
  it("enables F&B routing without overwriting the ERP backend", async () => {
    mock.state.mockResolvedValue({ point: { name: "Quầy", enabled: true, last_seen_at: null, routes: [{ key: "bar", label: "Bar", printer: "Máy Bar", paper: "58mm" }] }, jobs: [] });
    render(<FnbBranchPrintControl branchId="branch" />);
    fireEvent.click(screen.getByRole("button", { name: "Nơi nhận & lệnh in" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" })).toBeEnabled());
    expect(screen.getByText(/Máy Bar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" }));
    expect(mock.update).toHaveBeenCalledWith("print", { fnbBranchQueue: true });
  });
  it("blocks selection when the account cannot load the branch", async () => {
    mock.state.mockRejectedValue(new Error("Không có quyền sử dụng chi nhánh này."));
    render(<FnbBranchPrintControl branchId="foreign" />);
    fireEvent.click(screen.getByRole("button", { name: "Nơi nhận & lệnh in" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
  });
});
