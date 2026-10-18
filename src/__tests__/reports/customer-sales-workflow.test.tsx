import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const state=vi.hoisted(()=>({branch:"fnb",range:{from:"2026-10-01",to:"2026-10-18"},report:vi.fn(),products:vi.fn(),exportExcel:vi.fn(),toast:vi.fn(),refresh:undefined as (()=>void)|undefined}));
vi.mock("@/lib/contexts",()=>({useAuth:()=>({tenant:{id:"onebiz"}}),useBranchFilter:()=>({activeBranchId:state.branch,branchLabel:state.branch,isReady:true}),useToast:()=>({toast:state.toast})}));
vi.mock("@/lib/hooks/use-report-state",()=>({useReportState:()=>({preset:"custom",range:state.range,setPreset:vi.fn(),setCustomRange:vi.fn()})}));
vi.mock("@/lib/hooks/use-live-data-refresh",()=>({useLiveDataRefresh:(refresh:()=>void)=>{state.refresh=refresh;}}));
vi.mock("@/lib/utils/use-debounce",()=>({useDebounce:<T,>(value:T)=>value}));
vi.mock("@/lib/services",()=>({getCustomerProductReport:state.report,getCustomerProductExportRows:state.products,getCustomerProductDetailPage:async()=>({rows:[],total:0,revenue:0})}));
vi.mock("@/lib/utils/excel-export",async original=>({...await original<typeof import("@/lib/utils/excel-export")>(),exportReportToExcel:state.exportExcel}));
vi.mock("@/components/shared/report",()=>({ReportPageHeader:({onExportFull,exportDisabled}:{onExportFull:()=>void;exportDisabled:boolean})=><button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button>}));
vi.mock("@/app/(main)/phan-tich/_components",()=>({KpiCard:({label,value}:{label:string;value:string})=><div>{label}: {value}</div>,ChartCard:({children}:{children:ReactNode})=><div>{children}</div>}));
vi.mock("@/app/(main)/phan-tich/_components/client-chart-container",()=>({ClientChartContainer:()=>null}));
import CustomerReport from "@/app/(main)/phan-tich/khach-san-pham/page";

const report=(name="Alpha")=>({summary:{customerCount:1,orderCount:1,productCount:2,quantity:102,revenue:50,averageOrderValue:50,topTenShare:100},customers:[{customerId:"c1",customerCode:"A",customerName:name,orderCount:1,productCount:2,quantity:102,revenue:50,revenueShare:100,topProduct:"Tea",lastPurchaseAt:"2026-10-01"}],customerTotal:1,categories:[],matrix:[]});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
beforeEach(()=>{window.history.replaceState(null,"","/");localStorage.clear();state.branch="fnb";state.report.mockReset().mockResolvedValue(report());state.products.mockReset().mockResolvedValue([
  {customerCode:"A",customerName:"Alpha",productCode:"T1",productName:"Tea",categoryName:"Tea",unit:"G",orderCount:1,quantity:100,revenue:30,lastPurchaseAt:"2026-10-01"},
  {customerCode:"A",customerName:"Alpha",productCode:"T2",productName:"Drink",categoryName:"Tea",unit:"Ly",orderCount:1,quantity:2,revenue:20,lastPurchaseAt:"2026-10-01"},
  {customerCode:"B",customerName:"Beta",productCode:"T3",productName:"Other",categoryName:"Tea",unit:"G",orderCount:1,quantity:99,revenue:999,lastPurchaseAt:"2026-10-01"},
]);state.exportExcel.mockReset().mockResolvedValue(undefined);state.toast.mockReset();});
afterEach(cleanup);

describe("customer management report",()=>{
  it("exports searched customers only and separates category quantities by unit",async()=>{
    render(<CustomerReport/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeEnabled());
    fireEvent.change(screen.getByRole("textbox",{name:"Tìm khách hàng"}),{target:{value:"Alpha"}});
    await waitFor(()=>expect(state.report).toHaveBeenLastCalledWith(expect.objectContaining({search:"Alpha"})));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeEnabled());
    await act(async()=>screen.getByRole("button",{name:"Xuất đầy đủ"}).click());
    const file=state.exportExcel.mock.calls[0][0];
    const products=file.sheets.find((sheet:{name:string})=>sheet.name==="Khách hàng - Mặt hàng");
    expect(products.rows.map((row:{customerCode:string})=>row.customerCode)).toEqual(["A","A"]);
    const groups=file.sheets.find((sheet:{name:string})=>sheet.name==="Nhóm hàng");
    expect(groups.rows).toEqual(expect.arrayContaining([expect.objectContaining({unit:"G",quantity:100}),expect.objectContaining({unit:"Ly",quantity:2})]));
    expect(file.sheets.find((sheet:{name:string})=>sheet.name==="Khách hàng").columns.some((column:{key:string})=>column.key==="quantity")).toBe(false);
  });

  it("does not show or export old customers while a new branch is pending",async()=>{
    const view=render(<CustomerReport/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeEnabled());
    const next=deferred<ReturnType<typeof report>>();
    state.report.mockReturnValueOnce(next.promise);
    state.branch="retail";view.rerender(<CustomerReport/>);
    expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeDisabled();
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    await act(async()=>next.resolve(report("New customer")));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeEnabled());
  });

  it("stops a full export if its branch changes mid-request",async()=>{
    const view=render(<CustomerReport/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeEnabled());
    const pending=deferred<ReturnType<typeof report>>();
    state.report.mockReturnValueOnce(pending.promise);
    act(()=>screen.getByRole("button",{name:"Xuất đầy đủ"}).click());
    state.branch="retail";view.rerender(<CustomerReport/>);
    await act(async()=>pending.resolve(report()));
    expect(state.exportExcel).not.toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({description:"Phạm vi đã đổi. Vui lòng xuất lại."}));
  });
});
