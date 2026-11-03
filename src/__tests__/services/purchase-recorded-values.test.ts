import {beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({from:vi.fn(),select:vi.fn(),eq:vi.fn(),order:vi.fn()}));
vi.mock("@/lib/services/supabase/base",()=>({getClient:()=>({from:mocks.from}),getCurrentContext:vi.fn(),getCurrentTenantId:vi.fn(),getPaginationRange:vi.fn(),handleError:(error:Error)=>{throw error;}}));
import {getPurchaseOrderItems} from "@/lib/services/supabase/purchase-orders";
describe("recorded supplier line values",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({order:mocks.order});});
  it("uses recorded totals, preserving old ceil documents, discounts and transaction units",async()=>{
    mocks.order.mockResolvedValue({data:[
      {id:"apple",quantity:6,received_quantity:6,unit_price:4666.67,total:"28001.00",discount:0,vat_rate:0},
      {id:"discounted",quantity:3,received_quantity:1,unit_price:5333.33,total:"15000",discount:1000,vat_rate:10},
      {id:"converted",quantity:3,received_quantity:1,unit_price:13333.33333333,total:"40000",transaction_quantity:3000,transaction_unit_price:13.33333333,conversion_factor:0.001,transaction_unit:"G"},
    ],error:null});
    const rows=await getPurchaseOrderItems("saved");
    expect(mocks.select.mock.calls[0][0]).toMatch(/unit_price, total,/);
    expect(rows.map(row=>row.lineTotal)).toEqual([28001,15000,40000]);
    expect(rows[2]).toMatchObject({quantity:3000,receivedQuantity:1000,unitPrice:13.33333333,unit:"G"});
  });
});
