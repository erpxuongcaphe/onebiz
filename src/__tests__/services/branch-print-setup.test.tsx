import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
const mock = vi.hoisted(() => ({ state: vi.fn(), save: vi.fn(), check: vi.fn(), enqueue: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ currentBranch: { id: "branch-xtb", name: "Xưởng Tư Búa" }, hasPermission: () => true }) }));
vi.mock("@/lib/services/supabase/kitchen-stations", () => ({ getKitchenStationsByBranch: async () => [{ id: "bar", name: "Bar" }] }));
vi.mock("@/lib/printer/branch-queue", () => ({ getBranchPrintState: mock.state, savePrintPoint: mock.save, checkBranchPrinter: mock.check, enqueueBranchPrint: mock.enqueue, rotatePrintPointToken: vi.fn(), resolvePrintJob: vi.fn() }));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ settings: { print: { fnbBranchQueue: false } }, updateSettings: mock.update }) }));
import { BranchPrintSetup } from "@/components/shared/branch-print-setup";
const point = { id: "point", enabled: true, name: "Quầy", routes: [{ key: "cashier", label: "Quầy — bill / tạm tính", printer: "tcp://192.168.10.222:9100", paper: "80mm" }], last_seen_at: null };
beforeEach(() => { vi.clearAllMocks(); mock.state.mockResolvedValue({ point, jobs: [] }); mock.save.mockImplementation(async (_id, _name, routes, enabled) => ({ ...point, routes, enabled })); });
afterEach(cleanup);
describe("branch scoped printer setup", () => {
  it("only activates branch routing after both cashier and kitchen have saved destinations", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    expect(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
    cleanup();
    mock.state.mockResolvedValue({ point: { ...point, routes: [...point.routes,{...point.routes[0],key:"kitchen",label:"Bếp"}] }, jobs: [] });
    render(<BranchPrintSetup />); await waitFor(() => expect(screen.getAllByDisplayValue("192.168.10.222")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    fireEvent.click(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" }));
    expect(mock.update).toHaveBeenCalledWith("print", { fnbBranchQueue: true });
  });
  it("copies the cashier connection only to unassigned kitchen destinations in the current branch", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.click(screen.getByRole("button", { name: "Dùng chung máy hóa đơn cho bếp chưa gán" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu máy & nơi nhận" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith("branch-xtb", "Quầy", expect.arrayContaining([expect.objectContaining({ key: "cashier", printer: "tcp://192.168.10.222:9100" }), expect.objectContaining({ key: "bar", printer: "tcp://192.168.10.222:9100" })]), true));
  });
  it("prevents saving an invalid IP before any mutation", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.change(screen.getByLabelText("IP máy in"), { target: { value: "8.8.8.8" } }); fireEvent.click(screen.getByRole("button", { name: "Lưu máy & nơi nhận" }));
    await screen.findByText(/Dùng IP máy in trong mạng nội bộ/); expect(mock.save).not.toHaveBeenCalled();
  });
  it("checks a saved connection without creating a print payload", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" })); fireEvent.click(screen.getAllByRole("button", { name: "Kiểm tra kết nối" })[0]);
    await waitFor(() => expect(mock.check).toHaveBeenCalledWith("branch-xtb", point.routes[0])); expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("does not check an edited but unsaved destination", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.change(screen.getByLabelText("Cổng"), { target: { value: "9200" } }); fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" })); fireEvent.click(screen.getAllByRole("button", { name: "Kiểm tra kết nối" })[0]);
    await screen.findByText("Lưu thay đổi trước khi kiểm tra kết nối."); expect(mock.check).not.toHaveBeenCalled();
  });
});
