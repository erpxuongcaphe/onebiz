import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(() => ({rpc:vi.fn(),handleError:vi.fn((error:unknown) => {throw error;})}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({rpc:mocks.rpc}),handleError:mocks.handleError}));
import {getCashPerformers,recordTimedCash} from "@/lib/services/supabase/cash-timing";
beforeEach(()=>{vi.clearAllMocks();mocks.rpc.mockResolvedValue({data:{id:"cash-1"},error:null});});
describe("cash performer context",()=>{
  it("leaves existing POS/debt callers on the existing timing RPC",async()=>{
    await recordTimedCash("invoice",{referenceId:"invoice-1"},{});
    expect(mocks.rpc).toHaveBeenCalledWith("record_cash_transaction_timed",expect.not.objectContaining({p_performed_by:expect.anything()}));
  });
  it("delegates performer and cash timing together atomically",async()=>{
    await recordTimedCash("manual",{branchId:"branch-1",amount:100},{performedBy:"person-2",occurredAt:"2026-10-06T01:00:00Z",transactionDate:"2026-10-06"});
    expect(mocks.rpc).toHaveBeenCalledWith("record_cash_transaction_context",expect.objectContaining({p_performed_by:"person-2",p_operation:"manual",p_transaction_date:"2026-10-06"}));
  });
  it("does not retry as a metadata-free payment if the new RPC fails",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:new Error("unavailable")});
    await expect(recordTimedCash("manual",{amount:100},{performedBy:"person-2"})).rejects.toThrow("unavailable");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("loads only the server-authorized branch performer options",async()=>{
    mocks.rpc.mockResolvedValue({data:[{id:"person-2",name:"Employee"}],error:null});
    expect(await getCashPerformers("branch-1")).toEqual([{id:"person-2",name:"Employee"}]);
    expect(mocks.rpc).toHaveBeenCalledWith("get_cash_performers",{p_branch_id:"branch-1"});
  });
});
