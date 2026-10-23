import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => api, getCurrentTenantId: async () => "tenant-a",
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getReconciledShiftDetail } from "@/lib/services/supabase/shifts";

const scope = { tenant_id: "tenant-a", branch_id: "branch-a", shift_id: "shift-a" };
const invoice = (index: number) => ({ ...scope, document_kind: "invoice",
  id: `invoice-${index}`, code: `HD${index}`, status: "completed", total: 100,
  paid: 100, payment_method: "cash", source: "fnb", created_at: "2026-10-01T01:00:00Z",
});
const cash = (index: number) => ({ ...scope, document_kind: "cash",
  id: `cash-${index}`, code: `PT${index}`, type: "receipt", amount: 100,
  payment_method: "cash", status: index === 0 ? "cancelled" : "completed",
  category: "Thu bán hàng", transaction_date: "2026-10-01",
});
const page = (rows: unknown[] = [], total = rows.length, offset = 0) => ({
  ...scope, offset, limit: 200, total_count: total, revision: "revision-a", rows,
});
beforeEach(() => { vi.resetAllMocks(); api.rpc.mockResolvedValue({ data: page(), error: null }); });

describe("scoped reconciliation documents", () => {
  it("loads all documents through a single scoped source without table fallback", async () => {
    const rows = [...Array.from({length:1201}, (_,i)=>invoice(i)), ...Array.from({length:1001}, (_,i)=>cash(i))];
    api.rpc.mockImplementation(async (_name, args) => ({ data: page(rows.slice(args.p_offset,args.p_offset+200),rows.length,args.p_offset),error:null }));
    const result = await getReconciledShiftDetail("shift-a");
    expect(result.invoices).toHaveLength(1201); expect(result.transactions).toHaveLength(1001);
    expect(result.summary.completedSales).toBe(120100); expect(result.summary.cashReceipts).toBe(100000);
    expect(result.transactions[0].status).toBe("cancelled");
    expect(api.rpc).toHaveBeenCalledTimes(12);
    expect(api.rpc.mock.calls.every(([name])=>name==="get_shift_documents_scoped")).toBe(true);
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each([null, {...page(),shift_id:"other"}, {...page(),tenant_id:"other"},
    {...page(),branch_id:null}, {...page(),offset:1}, {...page(),limit:500},
    {...page(),rows:[{...invoice(0),branch_id:"other"}]}, {...page([invoice(0)]),total_count:0},
    page([{...invoice(0),total:null}]),page([{...cash(0),amount:"NaN"}]),
    page([{...invoice(0),status:"unknown"}]),page([{...cash(0),document_kind:"other"}]),
    page([{...cash(0),transaction_date:null}]),page([{...cash(0),type:"other"}]),
  ])("rejects wrong scope or malformed documents", async data => {
    api.rpc.mockResolvedValue({data,error:null});
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow();
    expect(api.from).not.toHaveBeenCalled();
  });
  it.each(["revision","count","branch","duplicate","empty","error"])("rejects incomplete pagination: %s",async failure=>{
    const rows=Array.from({length:201},(_,i)=>invoice(i));
    api.rpc.mockImplementation(async (_name,args)=>{
      const data=page(rows.slice(args.p_offset,args.p_offset+200),201,args.p_offset);
      if(args.p_offset===0)return {data,error:null};
      if(failure==="revision") data.revision="changed";
      if(failure==="count") data.total_count=202;
      if(failure==="branch") data.branch_id="other";
      if(failure==="duplicate") data.rows=[invoice(0)];
      if(failure==="empty") data.rows=[];
      return {data,error:failure==="error"?{message:"timeout"}:null};
    });
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow();
    expect(api.from).not.toHaveBeenCalled();
  });
  it("does not fall back after access denial",async()=>{
    api.rpc.mockResolvedValue({data:null,error:{message:"denied"}});
    await expect(getReconciledShiftDetail("shift-a")).rejects.toThrow("denied");
    expect(api.from).not.toHaveBeenCalled();
  });
  it("keeps identical IDs from different document types without conflating them",async()=>{
    api.rpc.mockResolvedValue({data:page([invoice(0),{...cash(0),id:invoice(0).id}]),error:null});
    const result=await getReconciledShiftDetail("shift-a");
    expect(result.invoices).toHaveLength(1);expect(result.transactions).toHaveLength(1);
  });
  it("accepts explicitly empty sources", async () => {
    expect(await getReconciledShiftDetail("shift-a")).toEqual({invoices:[],transactions:[],
      summary:{completedInvoiceCount:0,cancelledInvoiceCount:0,completedSales:0,ledgerReceipts:0,
        ledgerPayments:0,cashReceipts:0,cashPayments:0,netCashMovement:0}});
  });
});
