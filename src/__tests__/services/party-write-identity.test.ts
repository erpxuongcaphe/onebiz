import {beforeEach, describe, expect, it, vi} from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{table:string; method:string; args:unknown[]}>,
  writeError: false,
  audit: vi.fn(),
}));

vi.mock("@/lib/services/supabase/audit", () => ({recordAuditLog:state.audit}));
vi.mock("@/lib/services/supabase/customer-identity", () => ({
  getCustomerIdentityDirectory: vi.fn().mockResolvedValue([]),
  customerIdentity: vi.fn().mockReturnValue(undefined),
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getCurrentTenantId: async () => "tenant-test",
  getPaginationRange: () => ({from:0,to:14}),
  handleError: (error:Error) => {throw error;},
  getClient: () => ({from:(table:string) => {
    let writing=false;
    let projection="";
    const query:Record<string,unknown>={};
    for(const method of ["insert","update","eq","select"]) query[method]=(...args:unknown[])=>{
      state.calls.push({table,method,args});
      if(method==="insert"||method==="update") writing=true;
      if(method==="select") projection=String(args[0]??"*");
      return query;
    };
    query.maybeSingle=async()=>({data:{code:"OLD",name:"Old name",house_number:"12",street:"Old Street",ward:"Old Ward",province:"Old Province",country:"Việt Nam"},error:null});
    query.single=async()=>{
      if(writing&&state.writeError)return {data:null,error:new Error("Save denied")};
      if(projection.includes("*")||/\b(debt|total_sales|total_purchases)\b/.test(projection))return {data:null,error:new Error("Unexpected return columns")};
      return {data:{id:`${table}-test`,code:"TEST-001",name:"Synthetic party",phone:"0000000000",email:null,group_id:"group-test",customer_type:"individual",tax_code:"TEST",
        debt:999,total_sales:888,total_purchases:777},error:null};
    };
    return query;
  }}),
}));

import {createCustomer,updateCustomer} from "@/lib/services/supabase/customers";
import {createSupplier,updateSupplier} from "@/lib/services/supabase/suppliers";

const operations=[
  {name:"create customer",table:"customers",method:"insert",projection:"id, code, name, phone, email, group_id, customer_type",
    run:()=>createCustomer({name:"Synthetic party",phone:"0000000000",groupId:"group-test",code:"ignored"})},
  {name:"update customer",table:"customers",method:"update",projection:"id, code, name",
    run:()=>updateCustomer("customers-test",{name:"Synthetic party"})},
  {name:"create supplier",table:"suppliers",method:"insert",projection:"id, code, name, phone, email, tax_code",
    run:()=>createSupplier({name:"Synthetic party",phone:"0000000000",code:"TEST-001"})},
  {name:"update supplier",table:"suppliers",method:"update",projection:"id, code, name",
    run:()=>updateSupplier("suppliers-test",{name:"Synthetic party"})},
];

beforeEach(()=>{state.calls=[];state.writeError=false;state.audit.mockReset();});

describe("party write identity acknowledgements",()=>{
  it.each(operations)("$name returns only saved identity",async operation=>{
    expect(await operation.run()).toEqual({id:`${operation.table}-test`,code:"TEST-001",name:"Synthetic party"});
    const selects=state.calls.filter(call=>call.method==="select");
    expect(selects.at(-1)?.args).toEqual([operation.projection]);
    expect(selects.every(call=>!String(call.args[0]).includes("*")&&!/\b(debt|total_sales|total_purchases)\b/.test(String(call.args[0])))).toBe(true);
    const mutation=state.calls.find(call=>call.method===operation.method)!;
    expect(mutation.table).toBe(operation.table);
    expect(mutation.args[0]).not.toHaveProperty("debt");
    expect(mutation.args[0]).not.toHaveProperty("total_sales");
    expect(mutation.args[0]).not.toHaveProperty("total_purchases");
    if(operation.method==="insert")expect(mutation.args[0]).toHaveProperty("tenant_id","tenant-test");
    else {
      expect(state.calls).toContainEqual({table:operation.table,method:"eq",args:["tenant_id","tenant-test"]});
      expect(state.calls).toContainEqual({table:operation.table,method:"eq",args:["id",`${operation.table}-test`]});
    }
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({entityId:`${operation.table}-test`,action:operation.method==="insert"?"create":"update"}));
  });

  it.each(operations)("$name preserves rejected saves without logging success",async operation=>{
    state.writeError=true;
    await expect(operation.run()).rejects.toThrow("Save denied");
    expect(state.audit).not.toHaveBeenCalled();
  });

  it("keeps customer code generation and create audit fields",async()=>{
    await operations[0].run();
    expect(state.calls.find(call=>call.method==="insert")?.args[0]).toMatchObject({code:"",group_id:"group-test",is_active:true});
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({newData:{code:"TEST-001",name:"Synthetic party",phone:"0000000000",email:null,group_id:"group-test",customer_type:"individual"}}));
  });

  it("keeps supplier create audit fields",async()=>{
    await operations[2].run();
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({newData:{code:"TEST-001",name:"Synthetic party",phone:"0000000000",email:null,tax_code:"TEST"}}));
  });

  it.each([
    {table:"customers",run:()=>updateCustomer("customers-test",{ward:"New Ward"})},
    {table:"suppliers",run:()=>updateSupplier("suppliers-test",{ward:"New Ward"})},
  ])("preserves existing address parts for partial $table changes",async operation=>{
    await operation.run();
    const payload=state.calls.find(call=>call.method==="update")?.args[0] as {address:string;ward:string};
    expect(payload.ward).toBe("New Ward");
    expect(payload.address).toContain("12 Old Street");
    expect(payload.address).toContain("New Ward");
    expect(payload.address).toContain("Old Province");
    expect(payload.address).not.toContain("Old Ward");
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({oldData:expect.objectContaining({ward:"Old Ward"}),newData:payload}));
  });
});
