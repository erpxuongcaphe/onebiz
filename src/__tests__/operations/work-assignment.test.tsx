import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QualityEditorDialog } from "@/components/operations/quality-editor";
import { UserBranchContext } from "@/components/operations/user-picker";
import type { Workspace, Run } from "@/lib/operations/contracts";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";

vi.mock("@/components/ui/icon", () => ({ Icon: () => null }));
vi.mock("@/components/operations/evidence-files", () => ({ EvidenceFiles: () => null }));
const branch = "11111111-1111-4111-8111-111111111111";
const workspace = {
  branches: [{ id: branch, name: "Chi nhánh thử" }], people: [{ id: "tien", name: "Tiên" }, { id: "thu", name: "Thư" }],
  members: [], standards: [
    { id: "a", family_id: "a", branch_id: branch, status: "approved", title: "Pha chế", assignee_id: "tien" },
    { id: "b", family_id: "b", branch_id: branch, status: "approved", title: "Vệ sinh", assignee_id: "thu" },
    { id: "other", family_id: "other", branch_id: "other", status: "approved", title: "Việc chi nhánh khác" },
  ],
} as unknown as Workspace;
const quality = { can:{work:true}, assignments: [{ family_id: "a", manager_ids: ["tien", "thu"] }, { family_id: "b", manager_ids: ["thu"] }] } as unknown as QualityWorkspace;
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ people: workspace.people }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show(familyId?: string) {
  const onSave = vi.fn(async () => true);
  render(<UserBranchContext.Provider value={branch}><QualityEditorDialog editor={{ kind: "assignment", familyId }} workspace={workspace} quality={quality} branch={branch} period="2026-10" busy={false} error="" onClose={vi.fn()} onSave={onSave}/></UserBranchContext.Provider>);
  return onSave;
}
describe("per-work manager assignment", () => {
  it("prefills existing people, removes by x, and saves only the selected work with a reason", async () => {
    const onSave = show("a");
    expect(screen.getByLabelText("Công việc cần phân công")).toHaveValue("a");
    await screen.findByRole("button", { name: "Bỏ Tiên" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Bỏ Thư" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Bỏ Thư" }));
    fireEvent.change(screen.getByLabelText("Lý do phân công / thay đổi"), { target: { value: "Tiên phụ trách pha chế" } });
    fireEvent.click(screen.getByRole("button", { name: /^Lưu$/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("assignment", { familyId: "a", managerIds: ["tien"], note: "Tiên phụ trách pha chế" }));
    expect(quality.assignments[0].manager_ids).toEqual(["tien", "thu"]);
  });
  it("switching work resets selection to that work rather than copying the previous managers", async () => {
    show("a");
    await screen.findByRole("button", { name: "Bỏ Tiên" });
    fireEvent.change(screen.getByLabelText("Công việc cần phân công"), { target: { value: "b" } });
    await screen.findByRole("button", { name: "Bỏ Thư" });
    expect(screen.queryByRole("button", { name: "Bỏ Tiên" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Việc chi nhánh khác" })).toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`branch=${branch}&purpose=manager`), expect.anything());
  });
});
describe("manager confirms work is completed and met", () => {
  const criterion={id:"criterion",title:"Khu vực sạch sẽ",kind:"boolean",operator:"eq",threshold:1,samples:1,evidenceRequired:false};
  function showCheck(requireEvidence=false, threshold=1) {
    const onSave=vi.fn(async()=>true);
    const run={id:"run",title:"Khu vực pha chế",version:1,criteria:[{...criterion,evidenceRequired:requireEvidence,threshold}]} as unknown as Run;
    render(<QualityEditorDialog editor={{kind:"check",run}} workspace={workspace} quality={quality} branch={branch} period="2026-10" busy={false} error="" onClose={vi.fn()} onSave={onSave}/>);
    return onSave;
  }
  it("never prechecks a result and saves an explicit pass through the existing check action",async()=>{
    const onSave=showCheck();
    const pass=screen.getByRole('radio',{name:'Đã làm / Đạt'});
    expect(pass).not.toBeChecked();
    fireEvent.click(pass);
    fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));
    await waitFor(()=>expect(onSave).toHaveBeenCalledWith('check',expect.objectContaining({id:'run',result:'met',observations:[{criterionId:'criterion',slot:'1',value:1}]})));
  });
  it("does not bypass evidence requirements when a manager ticks pass",async()=>{
    const onSave=showCheck(true);
    fireEvent.click(screen.getByRole('radio',{name:'Đã làm / Đạt'}));
    fireEvent.submit(screen.getByRole('button',{name:/^Lưu$/}).closest('form')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(await screen.findByText('Chưa đủ kết quả hoặc minh chứng cho các lần kiểm tra.')).toBeInTheDocument();
  });
  it("preserves inverted boolean criteria where the passing value is zero",async()=>{
    const onSave=showCheck(false,0);
    fireEvent.click(screen.getByRole('radio',{name:'Đã làm / Đạt'}));
    fireEvent.click(screen.getByRole('button',{name:/^Lưu$/}));
    await waitFor(()=>expect(onSave).toHaveBeenCalledWith('check',expect.objectContaining({result:'met',observations:[{criterionId:'criterion',slot:'1',value:0}]})));
  });
});
