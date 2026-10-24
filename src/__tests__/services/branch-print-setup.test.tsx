import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
const mock = vi.hoisted(() => ({ state: vi.fn(), save: vi.fn(), check: vi.fn(), enqueue: vi.fn(), update: vi.fn(), template: vi.fn(), stations: vi.fn() }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ currentBranch: { id: "branch-xtb", name: "Xưởng Tư Búa" }, hasPermission: () => true }) }));
vi.mock("@/lib/services/supabase/kitchen-stations", () => ({ getKitchenStationsByBranch: mock.stations }));
vi.mock("@/lib/printer/print-test-template", () => ({ resolveBranchPrintTestBuilder: mock.template }));
vi.mock("@/lib/printer/branch-queue", () => ({ getBranchPrintState: mock.state, savePrintPoint: mock.save, checkBranchPrinter: mock.check, enqueueBranchPrint: mock.enqueue, rotatePrintPointToken: vi.fn(), resolvePrintJob: vi.fn() }));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ settings: { print: { fnbBranchQueue: false } }, updateSettings: mock.update }) }));
import { BranchPrintSetup } from "@/components/shared/branch-print-setup";
const point = { id: "point", enabled: true, name: "Quầy", routes: [{ key: "cashier", label: "Quầy — bill / tạm tính", printer: "tcp://192.168.10.222:9100", paper: "80mm" }], last_seen_at: null };
beforeEach(() => { vi.resetAllMocks(); mock.stations.mockResolvedValue([{ id: "bar", name: "Bar" }]); mock.template.mockResolvedValue(() => "test receipt"); mock.state.mockResolvedValue({ point, jobs: [] }); mock.save.mockImplementation(async (_id, _name, routes, enabled) => ({ ...point, routes, enabled })); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("branch scoped printer setup", () => {
  it("unlocks refresh after a stalled initial load and ignores its late result", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown[]) => void;
    mock.stations.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<BranchPrintSetup />);
    expect(screen.getByText("Đang tải cấu hình máy in…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cập nhật" })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/Tải cấu hình máy in quá thời gian/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cập nhật" })).toBeEnabled();
    await act(async () => { finish([]); });
    expect(screen.queryByDisplayValue("192.168.10.222")).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Cập nhật" })); });
    expect(screen.getByDisplayValue("192.168.10.222")).toBeInTheDocument();
  });
  it("shows the stalled template stage, unlocks on timeout, and never sends a late template", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    vi.useFakeTimers();
    let finish!: (builder: () => string) => void;
    mock.template.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    fireEvent.click(screen.getAllByRole("button", { name: "In thử" })[0]);
    expect(screen.getByText("Đang tải mẫu in thử… Chưa gửi phiếu.")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(screen.getByText(/Tải mẫu in quá thời gian/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "In thử" })[0]).toBeEnabled();
    await act(async () => { finish(() => "late receipt"); });
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
  it("keeps successful dispatch distinct from a failed history refresh", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    mock.enqueue.mockResolvedValue({ id: "test", route_label: "Quầy" });
    mock.state.mockRejectedValue(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    fireEvent.click(screen.getAllByRole("button", { name: "In thử" })[0]);
    await screen.findByText(/Đã nhận phiếu thử tới Quầy, nhưng chưa cập nhật được lịch sử/);
    expect(mock.enqueue).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Không gửi được phiếu thử/)).not.toBeInTheDocument();
  });
  it("only activates branch routing after both cashier and kitchen have saved destinations", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    expect(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" })).toBeDisabled();
    expect(mock.update).not.toHaveBeenCalled();
    cleanup();
    mock.state.mockResolvedValue({ point: { ...point, routes: [...point.routes,{...point.routes[0],key:"kitchen",label:"Bếp"}] }, jobs: [] });
    render(<BranchPrintSetup />); await waitFor(() => expect(screen.getAllByDisplayValue("192.168.10.222")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "3. In thử & sử dụng" }));
    fireEvent.click(screen.getByRole("button", { name: "Dùng điểm in chi nhánh" }));
    expect(mock.update).toHaveBeenCalledWith("print", { fnbBranchQueue: true });
  });
  it("copies the cashier connection only to unassigned kitchen destinations in the current branch", async () => {
    render(<BranchPrintSetup />); await screen.findByDisplayValue("192.168.10.222");
    fireEvent.click(screen.getByRole("button", { name: "Dùng chung máy hóa đơn cho bếp chưa gán" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu máy & nơi nhận" }));
    await waitFor(() => expect(mock.save).toHaveBeenCalledWith("branch-xtb", "Quầy", expect.arrayContaining([expect.objectContaining({ key: "cashier", printer: "tcp://192.168.10.222:9100" }), expect.objectContaining({ key: "bar", printer: "tcp://192.168.10.222:9100" })]), true, expect.objectContaining({autoPrintKitchen:true,autoPrintReceipt:true})));
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

describe("held old print tickets", () => {
  it("shows review action without raw marker and cannot act for read-only users", async () => {
    const { PrintJobList } = await import("@/components/shared/branch-print-setup");
    const jobs = [{id:"held",label:"Bill cũ",route_label:"Quầy",status:"failed" as const,created_at:"2026-10-24T01:00:00Z",actor_name:"Thu ngân",message:"[PRINT_QUEUE_STALE] Phiếu chờ quá 5 phút."}];
    const action = vi.fn();
    const view=render(<PrintJobList jobs={jobs} onAction={action}/>);
    expect(screen.getByText("Phiếu cũ · chờ xác nhận")).toBeInTheDocument();
    expect(screen.getByText("Phiếu chờ quá 5 phút.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Xác nhận in phiếu cũ"}));
    expect(action).toHaveBeenCalledWith("held","retry");
    view.rerender(<PrintJobList jobs={jobs}/>);
    expect(screen.queryByRole("button",{name:"Xác nhận in phiếu cũ"})).not.toBeInTheDocument();
  });
});
