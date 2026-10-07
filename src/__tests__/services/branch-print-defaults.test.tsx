import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn(), branch: "xtb" }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ tenant: { id: "tenant" }, currentBranch: { id: mock.branch }, hasPermission: () => true }) }));
vi.mock("@/lib/contexts/settings-context", () => ({ useSettings: () => ({ updateSettings: mock.update }) }));
vi.mock("@/lib/printer/branch-queue", () => ({ getBranchPrintState: mock.get }));
import { BranchPrintDefaults, saveDevicePrintOverride } from "@/components/shared/branch-print-defaults";
const point = { enabled: true, routes: [{key:"cashier"},{key:"kitchen"}], policy:{autoPrintKitchen:true,autoPrintReceipt:true,receiptStyle:"standard",kitchenTicketStyle:"compact"} };
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); mock.branch="xtb"; });
describe("branch print defaults on personal employee browsers", () => {
  it("loads shared triggers without asking a new phone to select the printer", async () => {
    mock.get.mockResolvedValue({point}); render(<BranchPrintDefaults />);
    await waitFor(() => expect(mock.update).toHaveBeenLastCalledWith("print", expect.objectContaining({fnbBranchQueue:true,autoPrintReceipt:true})));
  });
  it("scopes a manual-print exception to only this tenant and branch", async () => {
    saveDevicePrintOverride("tenant","xtb",{fnbBranchQueue:false}); mock.get.mockResolvedValue({point});
    const rendered=render(<BranchPrintDefaults />);
    await waitFor(() => expect(mock.update).toHaveBeenLastCalledWith("print",expect.objectContaining({fnbBranchQueue:false,autoPrintReceipt:true})));
    mock.branch="other"; rendered.rerender(<BranchPrintDefaults />);
    await waitFor(() => expect(mock.update).toHaveBeenLastCalledWith("print",expect.objectContaining({fnbBranchQueue:true})));
  });
  it("rejects a late response from the previous branch", async () => {
    let resolve!: (value: unknown) => void;
    mock.get.mockImplementation((branch:string) => branch === "xtb" ? new Promise(done => {resolve=done;}) : Promise.resolve({point:null}));
    const rendered=render(<BranchPrintDefaults />); mock.branch="other"; rendered.rerender(<BranchPrintDefaults />);
    await waitFor(() => expect(mock.update).toHaveBeenLastCalledWith("print",expect.objectContaining({fnbBranchQueue:false,autoPrintReceipt:false})));
    resolve({point}); await Promise.resolve();
    expect(mock.update).not.toHaveBeenCalledWith("print",expect.objectContaining({fnbBranchQueue:true}));
  });
});
