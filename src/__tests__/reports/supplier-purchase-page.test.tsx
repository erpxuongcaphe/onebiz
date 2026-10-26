import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const state = vi.hoisted(() => ({ branch: "branch-a", kpi: vi.fn(), export: vi.fn(), summary: vi.fn(), detail: false, range:{from:"2026-10-01",to:"2026-10-03"} }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>Receipt basis fixture</div> }));
vi.mock("@/lib/contexts", () => ({ useBranchFilter: () => ({ activeBranchId: state.branch, branchLabel: state.branch, branches: [], isReady: true }), useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/contexts/auth-context", () => ({ useAuth: () => ({ user:{id:"user-fixture"},tenant:{id:"tenant-fixture"},hasPermission: () => state.detail }) }));
vi.mock("@/lib/hooks/use-report-state", () => ({ useReportState: () => ({ preset:"custom",range:state.range,viewMode:"table",setPreset:vi.fn(),setCustomRange:vi.fn(),setViewMode:vi.fn() }) }));
vi.mock("@/components/shared/report", () => ({
  ReportPageHeader: ({onExportFull,exportDisabled}:{onExportFull:()=>void;exportDisabled:boolean}) => <button disabled={exportDisabled} onClick={onExportFull}>Xuất đầy đủ</button>,
  ReportDataTable: () => null,
}));
vi.mock("@/app/(main)/phan-tich/_components", () => ({ KpiCard: ({label,value,change}:{label:string;value:string;change:string}) => <section aria-label={label}><h2>{label}</h2><p>{value}</p><span>{change}</span></section>,ChartCard: ({children}:{children:ReactNode}) => <div>{children}</div> }));
vi.mock("@/lib/services", () => ({
  getSupplierKpis:state.kpi,getPurchaseByMonth:async()=>[],getTopSuppliersByPurchase:async()=>[],getSupplierPaymentStatus:async()=>[],getSupplierSummary:state.summary,getPurchaseOrders:async()=>({data:[],total:0}),getPayableAgingReport:async()=>({rows:[]}),
}));
vi.mock("@/lib/utils/excel-export", () => ({ exportReportToExcel:state.export,buildReportTitleRows:()=>["Fixture"] }));
import Page from "@/app/(main)/phan-tich/nha-cung-cap/page";
const kpi={totalSuppliers:0,purchaseThisMonth:100,prevPurchase:0,totalDebt:0,prevDebt:0,returnCount:1,returnAmount:20,prevReturnAmount:0,netPurchase:80,prevNetPurchase:0};
beforeEach(()=>{state.branch="branch-a";state.detail=false;state.kpi.mockReset().mockResolvedValue(kpi);state.summary.mockReset().mockResolvedValue([]);state.export.mockReset().mockResolvedValue(undefined);});
afterEach(cleanup);
describe("supplier purchase report",()=>{
  it("keeps physical receipt values separate from completed-voucher KPIs and exports",async()=>{
    state.detail=true;render(<Page/>);await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    fireEvent.click(screen.getByRole("button",{name:/^Thực nhập$/}));
    expect(screen.getByText("Receipt basis fixture")).toBeInTheDocument();
    expect(screen.queryByRole("region",{name:"Mua thuần trong kỳ"})).not.toBeInTheDocument();
    expect(state.export).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:/^Phiếu nhập$/}));
    await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    expect(screen.queryByText("Receipt basis fixture")).not.toBeInTheDocument();
  });
  it("keeps missing return and net amounts unavailable on screen and in Excel",async()=>{
    state.kpi.mockResolvedValue({...kpi,returnAmount:null,netPurchase:null});
    render(<Page/>);
    const net=await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    expect(within(net).getByText("Chưa đủ dữ liệu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Xuất đầy đủ"}));
    await waitFor(()=>expect(state.export).toHaveBeenCalledTimes(1));
    expect(state.export.mock.calls[0][0].sheets[0].rows).toContainEqual({metric:"Mua thuần trong kỳ",value:null});
  });
  it("shows the gross-return-net bridge and uses a new-base label instead of +100%",async()=>{
    render(<Page/>);
    const net=await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    expect(within(net).getByText("80")).toBeInTheDocument();
    expect(within(net).getByText("Phát sinh mới")).toBeInTheDocument();
    expect(screen.queryByText("+100%")).not.toBeInTheDocument();
    expect(screen.getByRole("region",{name:"Đối chiếu mua và trả NCC"})).toHaveTextContent("100 đTrả NCC20 đMua thuần80 đ");
    fireEvent.click(screen.getByRole("button",{name:"Xuất đầy đủ"}));
    await waitFor(()=>expect(state.export).toHaveBeenCalledTimes(1));
    expect(state.export.mock.calls[0][0].sheets[0].rows).toEqual(expect.arrayContaining([{metric:"Mua gộp trong kỳ",value:100},{metric:"Trả NCC trong kỳ",value:20},{metric:"Mua thuần trong kỳ",value:80}]));
    expect(state.export.mock.calls[0][0].sheets[0].columns.find((column:{key:string})=>column.key==="value")).toMatchObject({format:"number",decimalPlaces:2});
  });
  it("hides old figures when the new branch load fails",async()=>{
    const view=render(<Page/>);
    await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    state.kpi.mockRejectedValue(new Error("Fixture source unavailable"));state.branch="branch-b";view.rerender(<Page/>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Fixture source unavailable");
    expect(screen.queryByRole("region",{name:"Mua thuần trong kỳ"})).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Xuất đầy đủ"})).toBeDisabled();
  });
  it("does not export an old branch after full-export reads finish late",async()=>{
    let resolve!:(value:[])=>void;const old=new Promise<[]>(done=>{resolve=done;});
    const view=render(<Page/>);await screen.findByRole("region",{name:"Mua thuần trong kỳ"});
    state.summary.mockReturnValueOnce(old);
    fireEvent.click(screen.getByRole("button",{name:"Xuất đầy đủ"}));
    state.branch="branch-b";view.rerender(<Page/>);
    await act(async()=>{resolve([]);});
    expect(state.export).not.toHaveBeenCalled();
  });
});
