import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { describeEffectiveRights } from "@/lib/admin/staff-effective-access";
import type { StaffEffectiveAccess } from "@/lib/services/supabase/staff-effective-access";
const state = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/services/supabase/staff-effective-access", () => ({ getStaffEffectiveAccess: state.load }));
import { StaffEffectiveAccessDialog } from "@/components/shared/dialogs/staff-effective-access-dialog";
function fixture(id = "thu"): StaffEffectiveAccess {
  return { user: { id, fullName: id, role: "staff", isActive: true, branchIds: ["premium"] }, role: null,
    hierarchy: { version: 3, document: { positions: [{ id:"manager",name:"Cửa hàng trưởng",parentId:null,scope:"branch",depth:"all",permissions:{create:true,edit:false,password:true} }], assignments:[{userId:id,positionId:"manager",departmentId:null,managedBranchIds:[]}], departments:[],globalAdminIds:[] } },
    effective: ["system.create_user", "inventory.view"], overrides: [], checkedAt:"2026-11-10T16:00:00Z" };
}
beforeEach(() => {vi.clearAllMocks();state.load.mockResolvedValue(fixture());});
it("uses server decisions even where position and revoke explanations differ", () => {
 const data=fixture();
 data.overrides=[{id:"override",tenantId:"tenant",userId:"thu",permissionCode:"system.reset_user_password",overrideType:"revoke",note:null,createdAt:"",createdBy:null}];
 const rights=describeEffectiveRights(data);
 expect(rights.find(p=>p.code==="system.reset_user_password")).toMatchObject({allowed:false,sources:["Chức vụ Cửa hàng trưởng","Thu hồi riêng"]});
 expect(rights.find(p=>p.code==="system.create_user")).toMatchObject({allowed:true,scoped:true});
 expect(rights.find(p=>p.code==="inventory.view")).toMatchObject({allowed:true,sources:["Máy chủ xác nhận"]});
});
it("never turns a failed read into a no-permissions report, and supports retry", async () => {
 state.load.mockRejectedValueOnce(new Error("Mất kết nối"));
 render(<StaffEffectiveAccessDialog tenantId="tenant" userId="thu" branchNames={new Map([["premium","Premium"]])} onClose={vi.fn()}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Mất kết nối");
 expect(screen.queryByLabelText("Lọc quyền thực tế")).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));
 expect(await screen.findByLabelText("Lọc quyền thực tế")).toBeVisible();
 expect(screen.getByText("Truy cập: Premium")).toBeVisible();
});
it("discards stale responses after selecting another employee", async () => {
 let resolveFirst!: (value:StaffEffectiveAccess)=>void;
 state.load.mockReturnValueOnce(new Promise(resolve=>{resolveFirst=resolve;}));
 const props={tenantId:"tenant",branchNames:new Map(),onClose:vi.fn()};
 const view=render(<StaffEffectiveAccessDialog {...props} userId="first"/>);
 state.load.mockResolvedValueOnce(fixture("second"));
 view.rerender(<StaffEffectiveAccessDialog {...props} userId="second"/>);
 expect(await screen.findByRole("heading",{name:"Quyền thực tế · second"})).toBeVisible();
 await act(async()=>resolveFirst(fixture("first")));
 expect(screen.getByRole("heading",{name:"Quyền thực tế · second"})).toBeVisible();
});
it("warns that inactive accounts cannot use their configured rights", async () => {
 const data=fixture();data.user.isActive=false;state.load.mockResolvedValue(data);
 render(<StaffEffectiveAccessDialog tenantId="tenant" userId="thu" branchNames={new Map()} onClose={vi.fn()}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("Tài khoản đã ngừng hoạt động");
});
