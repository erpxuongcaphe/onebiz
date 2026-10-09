import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({ eq:vi.fn(),neq:vi.fn(),or:vi.fn(),result:{data:[{id:"internal-1",code:"NB-XTB",name:"Xưởng Tư Búa",is_internal:true,branch_id:"branch-xtb"}],count:1,error:null} }));
vi.mock("@/lib/services/supabase/base",()=>({
 getCurrentTenantId:async()=>"tenant-1", getPaginationRange:()=>({from:0,to:9}),
 handleError:(error:Error)=>{throw error;},
 getClient:()=>{const chain:Record<string,unknown>={};
 for(const name of ["select","order","range","ilike","in","gte","lte"]) chain[name]=()=>chain;
 chain.eq=(...args:unknown[])=>{mocks.eq(...args);return chain;};
 chain.neq=(...args:unknown[])=>{mocks.neq(...args);return chain;};
 chain.or=(...args:unknown[])=>{mocks.or(...args);return chain;};
 chain.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve(mocks.result).then(resolve);
 chain.single=async()=>({...mocks.result,data:mocks.result.data[0]});
 return {from:()=>chain};},
}));
import {getCustomers,getCustomerById} from "@/lib/services/supabase/customers";
describe("Internal POS customer boundary",()=>{
 beforeEach(()=>vi.clearAllMocks());
 it("filters internal customers on the database before pagination, within tenant",async()=>{
  const result=await getCustomers({page:0,pageSize:10,filters:{internalOnly:"true",excludeBranch:"warehouse"}});
  expect(mocks.eq).toHaveBeenCalledWith("tenant_id","tenant-1");
  expect(mocks.eq).toHaveBeenCalledWith("is_internal",true);
  expect(mocks.neq).toHaveBeenCalledWith("branch_id","warehouse");
  expect(result.data[0]).toMatchObject({isInternal:true,branchId:"branch-xtb"});
 });
 it("keeps public retail search separate from internal codes",async()=>{
  await getCustomers({page:0,pageSize:10,filters:{}});
  expect(mocks.or).toHaveBeenCalledWith("is_internal.is.null,is_internal.eq.false");
 });
 it("retains internal identity when reopening a saved cart",async()=>{
  expect(await getCustomerById("internal-1")).toMatchObject({id:"internal-1",isInternal:true,branchId:"branch-xtb"});
 });
});
