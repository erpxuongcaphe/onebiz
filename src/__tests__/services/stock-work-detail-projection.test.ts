import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: m.from, rpc: m.rpc }),
  getCurrentTenantId: async () => "tenant",
  handleError: (error: {message: string}) => { throw new Error(error.message); },
}));
import { getStockDocumentDetail } from "@/lib/services/supabase/stock-documents";
beforeEach(() => {
  vi.clearAllMocks();
  m.from.mockImplementation(() => {
    const q: Record<string, unknown> = {};
    for (const name of ["select", "eq", "maybeSingle"]) q[name] = () => q;
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
    return q;
  });
});
describe("safe stock work detail", () => {
  it("uses the action-scoped projection without reading cost-bearing item tables", async () => {
    m.rpc.mockResolvedValue({ data: {id:"doc",code:"XH1",status:"draft",items:[{id:"line",productName:"Milk",unit:"box",quantity:2}]}, error:null });
    const detail=await getStockDocumentDetail("disposal_export","doc");
    expect(detail?.items).toEqual([{id:"line",productCode:"—",productName:"Milk",unit:"box",quantity:2,unitPrice:undefined,amount:undefined}]);
    expect(detail?.totalAmount).toBeUndefined();
    expect(m.rpc).toHaveBeenCalledWith("get_stock_work_document_detail",{p_kind:"disposal_export",p_id:"doc"});
    expect(m.from).not.toHaveBeenCalled();
  });
  it("does not reveal documents outside the caller's action scope", async () => {
    m.rpc.mockResolvedValue({data:null,error:{code:"42501",message:"denied"}});
    expect(await getStockDocumentDetail("internal_export","doc")).toBeNull();
  });
  it("fails closed on malformed projection responses", async () => {
    m.rpc.mockResolvedValue({data:{id:"another",items:[]},error:null});
    await expect(getStockDocumentDetail("disposal_export","doc")).rejects.toThrow("không hợp lệ");
  });
  it("shows prices only when the scoped server projection includes them", async () => {
    m.rpc.mockResolvedValue({data:{id:"doc",totalAmount:999,items:[{id:"line",quantity:2,unitPrice:333,amount:666}]},error:null});
    const detail=await getStockDocumentDetail("disposal_export","doc");
    expect(detail?.totalAmount).toBe(999); expect(detail?.items[0].unitPrice).toBe(333);
  });
});
