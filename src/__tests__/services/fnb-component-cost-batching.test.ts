import { describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn(), eq: vi.fn(), requests: [] as Array<{table:string; ids:string[]}> }));
vi.mock("@/lib/services/supabase/base", () => ({getClient:()=>({from:mock.from}),getCurrentTenantId:async()=>"tenant-a",handleError:(error:unknown)=>{throw error;}}));
import { getFnbBranchComponentCosts } from "@/lib/services/supabase/fnb-branch-cost";

describe("F&B component cost batches", () => {
  it("keeps every component beyond 500 and scopes every read to the selected tenant and branch", async () => {
    mock.from.mockImplementation((table:string) => {
      let ids:string[]=[];
      const query={select:()=>query,eq:(...args:unknown[])=>{mock.eq(...args);return query;},is:()=>query,in:(_field:string,values:string[])=>{ids=values;mock.requests.push({table,ids});return query;},
        then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:ids.map(id=>table==="branch_stock"?{product_id:id,quantity:10}:{product_id:id,unit_cost:7,costed_quantity:10}),error:null}).then(resolve)};
      return query;
    });
    const ids=Array.from({length:601},(_,index)=>`material-${index}`);
    const result=await getFnbBranchComponentCosts("branch-b", [...ids,ids[0]]);
    expect(result.size).toBe(601);
    expect(result.get("material-600")).toMatchObject({unitCost:7,physicalQuantity:10});
    expect(mock.requests.map(request=>request.ids.length)).toEqual([500,500,101,101]);
    expect(mock.eq.mock.calls.filter(args=>args[0]==="tenant_id")).toEqual(Array.from({length:4},()=>["tenant_id","tenant-a"]));
    expect(mock.eq.mock.calls.filter(args=>args[0]==="branch_id")).toEqual(Array.from({length:4},()=>["branch_id","branch-b"]));
  });
});
