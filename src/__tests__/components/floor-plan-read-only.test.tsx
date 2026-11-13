import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,describe,expect,it,vi } from "vitest";
import type { ComponentType } from "react";

const s=vi.hoisted(()=>({branch:{id:"a",name:"Quán A"} as {id:string;name:string}|null,view:true,editBranch:false,assigned:true,reportAll:false,zones:vi.fn(),tables:vi.fn(),decorations:vi.fn(),editor:vi.fn(),branches:vi.fn()}));
vi.mock("@/lib/contexts",()=>({useAuth:()=>({currentBranch:s.branch,hasAssignedBranchAccess:()=>s.assigned}),useToast:()=>({toast:vi.fn()})}));
vi.mock("@/lib/permissions",()=>({usePermissions:()=>({isLoading:false,hasPermission:(code:string)=>code==="floor_plan.view"?s.view:code==="floor_plan.edit_branch"?s.editBranch:code==="reports.view_all_branches"?s.reportAll:false})}));
vi.mock("@/lib/services",()=>({getBranches:s.branches}));
vi.mock("@/components/shared/floor-plan/floor-plan-editor",()=>({FloorPlanEditor:s.editor}));
vi.mock("@/lib/services/supabase/floor-plan",()=>({getFloorPlanZones:s.zones,getTablesByZone:s.tables}));
vi.mock("@/lib/services/supabase/floor-plan-decorations",()=>({getDecorationsByZone:s.decorations}));
vi.mock("next/dynamic",()=>({default:()=>((props:{mode:string;tables:{name:string}[];onTableLayoutChange?:unknown})=><div data-testid="canvas" data-mode={props.mode} data-edit={String(!!props.onTableLayoutChange)}>{props.tables.map(table=>table.name).join(", ")}</div>) as ComponentType}));
import Page from "@/app/(main)/he-thong/so-do-ban/page";

beforeEach(()=>{
  vi.clearAllMocks();s.branch={id:"a",name:"Quán A"};s.view=true;s.editBranch=false;s.assigned=true;s.reportAll=false;
  s.branches.mockResolvedValue([{id:"a",name:"Quán A",branchType:"store"}]);
  s.zones.mockResolvedValue([{id:"zone-a",name:"Trong nhà"},{id:"zone-b",name:"Ngoài sân"}]);
  s.tables.mockImplementation(async(id:string)=>[{name:id==="zone-a"?"Bàn A":"Bàn B"}]);
  s.decorations.mockResolvedValue([]);
});
describe("sơ đồ bàn chỉ xem",()=>{
  it("người có quyền xem mở sơ đồ, đổi khu vực mà không nhận công cụ sửa",async()=>{
    render(<Page/>);
    expect(await screen.findByText("Quán A · Chế độ chỉ xem")).toBeInTheDocument();
    expect(await screen.findByText("Bàn A")).toBeInTheDocument();
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-mode","view");
    expect(screen.getByTestId("canvas")).toHaveAttribute("data-edit","false");
    fireEvent.click(screen.getByRole("button",{name:"Ngoài sân"}));
    expect(await screen.findByText("Bàn B")).toBeInTheDocument();
    expect(s.editor).not.toHaveBeenCalled();
  });
  it("giữ nguyên màn chỉnh sửa khi người dùng có quyền sửa tại quán",async()=>{
    s.editBranch=true;render(<Page/>);
    await waitFor(()=>expect(s.editor).toHaveBeenCalled());
    expect(s.editor.mock.calls.at(-1)?.[0]).toMatchObject({branchId:"a",scope:"branch"});
    expect(s.zones).not.toHaveBeenCalled();
  });
  it("không tải dữ liệu khi chưa có quyền hoặc không được vào chi nhánh",()=>{
    s.assigned=false;render(<Page/>);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(s.zones).not.toHaveBeenCalled();
  });
  it("không tải dữ liệu khi chưa có quyền xem",()=>{
    s.view=false;render(<Page/>);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(s.zones).not.toHaveBeenCalled();
  });
  it("giữ phạm vi xem toàn chuỗi đã được cấp và yêu cầu chọn quán khi đang xem tất cả",async()=>{
    s.assigned=false;s.reportAll=true;const {rerender}=render(<Page/>);
    expect(await screen.findByText("Quán A · Chế độ chỉ xem")).toBeInTheDocument();
    s.branch=null;rerender(<Page/>);
    expect(screen.getByText(/Chọn một chi nhánh trên thanh phía trên/)).toBeInTheDocument();
  });
  it("hiện lỗi và cho tải lại khi không lấy được khu vực",async()=>{
    s.zones.mockRejectedValueOnce(new Error("network"));render(<Page/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được khu vực");
    fireEvent.click(screen.getByRole("button",{name:"Thử lại"}));
    expect(await screen.findByText("Bàn A")).toBeInTheDocument();
  });
  it("không để màn hình tải vô thời hạn khi kết nối bị treo",async()=>{
    vi.useFakeTimers();
    try {
      s.zones.mockReturnValue(new Promise(()=>{}));render(<Page/>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(15000);});
      expect(screen.getByRole("alert")).toHaveTextContent("Không tải được khu vực");
    } finally {vi.useRealTimers();}
  });
  it("không hiển thị kết quả quán cũ khi chuyển chi nhánh trong lúc tải",async()=>{
    let finish!:(zones:{id:string;name:string}[])=>void;
    s.zones.mockImplementation((branch:string)=>branch==="a"?new Promise(resolve=>{finish=resolve;}):Promise.resolve([{id:"zone-b",name:"Khu B"}]));
    const {rerender}=render(<Page/>);
    await waitFor(()=>expect(s.zones).toHaveBeenCalledWith("a"));
    s.branch={id:"b",name:"Quán B"};rerender(<Page/>);
    expect(await screen.findByText("Quán B · Chế độ chỉ xem")).toBeInTheDocument();
    await act(async()=>finish([{id:"zone-a",name:"Khu cũ"}]));
    expect(screen.queryByText("Khu cũ")).not.toBeInTheDocument();
  });
  it("gỡ sơ đồ cũ khi chuyển sang chi nhánh không được cấp quyền xem",async()=>{
    const {rerender}=render(<Page/>);
    expect(await screen.findByText("Bàn A")).toBeInTheDocument();
    s.branch={id:"b",name:"Quán B"};s.view=false;
    rerender(<Page/>);
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    expect(screen.queryByText("Bàn A")).not.toBeInTheDocument();
    expect(s.zones).not.toHaveBeenCalledWith("b");
  });
});
