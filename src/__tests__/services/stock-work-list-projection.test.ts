import { beforeEach, describe, expect, it, vi } from "vitest";
const rpc=vi.fn();
vi.mock("@/lib/services/supabase/base", () => ({
  getClient:()=>({rpc}), getCurrentContext:vi.fn(), getCurrentTenantId:vi.fn(), getPaginationRange:vi.fn(),
  handleError:(error:{message:string})=>{throw new Error(error.message);},
}));
import { getDisposalExportListWorkspace, getInternalExportListWorkspace } from "@/lib/services/supabase/inventory";
beforeEach(()=>vi.clearAllMocks());
const summary={completedCount:1,draftCount:0,cancelledCount:0,completedValue:null};
describe("stock work lists",()=>{
  it.each([["disposal_export",getDisposalExportListWorkspace],["internal_export",getInternalExportListWorkspace]] as const)(
    "keeps masked values distinct from zero for %s",async(kind,read)=>{
      rpc.mockResolvedValue({data:{items:[{id:"doc",code:"X1",status:"completed",total_amount:null,costVisible:false}],total:1,costVisible:false,summary},error:null});
      const result=await read({page:0,pageSize:20,branchId:"branch"});
      expect(result.data[0].costVisible).toBe(false); expect(result.summary.costVisible).toBe(false);
      expect(rpc).toHaveBeenCalledWith("get_stock_work_document_list",expect.objectContaining({p_kind:kind,p_branch:"branch"}));
    },
  );
  it("rejects a response that includes cost despite claiming it is masked",async()=>{
    rpc.mockResolvedValue({data:{items:[{id:"doc",total_amount:999,costVisible:false}],total:1,costVisible:false,summary},error:null});
    await expect(getDisposalExportListWorkspace({page:0,pageSize:20})).rejects.toThrow("không hợp lệ");
  });
  it("explains why value filters cannot be used without cost access",async()=>{
    rpc.mockResolvedValue({data:null,error:{message:"STOCK_WORK_VALUE_FILTER_DENIED",code:"42501"}});
    await expect(getInternalExportListWorkspace({page:0,pageSize:20,amountMin:5})).rejects.toThrow("chưa có quyền xem giá vốn");
  });
});
