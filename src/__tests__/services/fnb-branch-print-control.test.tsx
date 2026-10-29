import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
const mock = vi.hoisted(() => ({ state: vi.fn(), update: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ tenant: { id: "tenant" } }) }));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ settings: { print: { backend: "qz-tray", fnbBranchQueue: false, autoPrintKitchen: true, autoPrintReceipt: false } }, updateSettings: mock.update }) }));
vi.mock("@/lib/contexts/toast-context", () => ({ useToast: () => ({ toast: mock.toast }) }));
vi.mock("@/lib/printer/branch-queue", () => ({ getBranchPrintState: mock.state, getBranchPrintJobState: mock.state }));
import { FnbBranchPrintControl } from "@/components/shared/fnb-branch-print-control";
beforeEach(() => { cleanup(); vi.clearAllMocks(); });
describe("personal-phone branch print selection", () => {
  it("shows recent jobs immediately without expanding a hidden history", async () => {
    mock.state.mockResolvedValue({ point: null, jobs: [{ id: "job", label: "Bếp KB000078", route_label: "Bar", status: "queued", created_at: "2026-10-10T01:00:00Z", actor_name: "Nhân viên", message: null }] });
    render(<FnbBranchPrintControl branchId="branch" compact />);
    fireEvent.click(screen.getByRole("button", { name: "Nơi nhận & lệnh in" }));
    expect(await screen.findByText("Bếp KB000078 · Bar")).toBeVisible();
    expect(screen.getByText("Chờ điểm in")).toBeVisible();
  });
  it("lets staff select kitchen and receipt triggers independently", async () => {
    mock.state.mockResolvedValue({ point: null, jobs: [] });
    render(<FnbBranchPrintControl branchId="branch" />);
    fireEvent.click(screen.getByRole("button", { name: "Nơi nhận & lệnh in" }));
    fireEvent.click(screen.getByText("Ngoại lệ trên thiết bị này"));
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

describe("POS print feedback without opening history",()=>{
 it("shows pending then error badge for an accepted bill without any physical retry",async()=>{
  vi.useFakeTimers();
  try{
   mock.state.mockResolvedValue({point:{connected:true},jobs:[{id:"live",label:"Bill test",route_label:"Quầy",status:"failed",created_at:new Date().toISOString(),actor_name:"Thu ngân",message:"Không kết nối được máy in."}]});
   render(<FnbBranchPrintControl branchId="branch" compact/>);
   act(()=>{window.dispatchEvent(new CustomEvent("onebiz-print-result",{detail:{queued:{id:"live",branchId:"branch",label:"Bill test",routeLabel:"Quầy"}}}));});
   expect(screen.getByText("1 chờ")).toBeVisible();
   await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
   expect(screen.getByText("! 1")).toBeVisible();
   expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({title:"Có phiếu chưa gửi được",variant:"error"}));
   expect(mock.state).toHaveBeenCalledExactlyOnceWith("branch",["live"],expect.any(AbortSignal));
  }finally{vi.useRealTimers();}
 });
});
