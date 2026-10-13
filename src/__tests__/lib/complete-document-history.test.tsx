import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks=vi.hoisted(()=>({export:vi.fn(),allowed:true}));
vi.mock("@/lib/permissions/use-permission",()=>({usePermissions:()=>({hasPermission:()=>mocks.allowed})}));
vi.mock("@/lib/utils/export",()=>({exportToExcel:mocks.export}));
import { DetailItemsTable } from "@/components/shared/inline-detail-panel/detail-items-table";
const rows=Array.from({length:71},(_,i)=>({id:String(i),code:`HD${String(i).padStart(3,"0")}`,date:"2026-10-01",totalAmount:i+1,paid:0,debt:i+1,status:i===0 ? "cancelled" : "completed"}));
const columns=[{header:"Mã",accessor:"code" as const},{header:"Trạng thái",accessor:"status" as const}];
beforeEach(()=>{cleanup();vi.clearAllMocks();mocks.allowed=true;mocks.export.mockResolvedValue(undefined);});
describe("accessible complete document history",()=>{
  it("makes every page accessible and searches older cancelled records",()=>{
    render(<DetailItemsTable pageSize={25} columns={columns} items={rows}/>);
    expect(screen.getAllByRole("link")).toHaveLength(25);
    fireEvent.click(screen.getByRole("button",{name:"Sau"}));
    expect(screen.getByText(/Trang 2\/3/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Tìm trong toàn bộ lịch sử chứng từ"),{target:{value:"HD000"}});
    expect(screen.getByText("cancelled")).toBeInTheDocument();
    expect(screen.getByText(/1\/71 chứng từ/)).toBeInTheDocument();
  });
  it("exports all matching rows in selected order, not just the visible page",async()=>{
    render(<DetailItemsTable pageSize={25} columns={columns} items={rows}/>);
    fireEvent.change(screen.getByLabelText("Sắp xếp lịch sử chứng từ"),{target:{value:"amount:desc"}});
    fireEvent.click(screen.getByRole("button",{name:"Xuất Excel"}));
    await waitFor(()=>expect(mocks.export).toHaveBeenCalled());
    const exported=mocks.export.mock.calls[0][0];
    expect(exported).toHaveLength(71);
    expect(exported[0]).toMatchObject({code:"HD070",total:71});
    expect(exported.at(-1).status).toBe("Đã hủy");
  });
  it("does not expose export without the existing permission",()=>{
    mocks.allowed=false;
    render(<DetailItemsTable pageSize={25} columns={columns} items={rows}/>);
    expect(screen.queryByRole("button",{name:"Xuất Excel"})).toBeNull();
  });
  it("filters dates and cancelled status across all history",async()=>{
    render(<DetailItemsTable pageSize={25} columns={columns} items={rows}/>);
    fireEvent.change(screen.getByLabelText("Trạng thái chứng từ lịch sử"),{target:{value:"cancelled"}});
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Từ ngày"),{target:{value:"2026-11-01"}});
    fireEvent.change(screen.getByLabelText("Đến ngày"),{target:{value:"2026-10-01"}});
    expect(screen.getByRole("alert")).toHaveTextContent("Ngày bắt đầu");
    expect(screen.getByRole("button",{name:"Xuất Excel"})).toBeDisabled();
  });
});
