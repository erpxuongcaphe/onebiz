import { describe, expect, it, vi } from "vitest";
import { readAuthBootstrap } from "@/lib/auth/bootstrap";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
const fixture = () => ({version:1,profile:{id:"user",tenant_id:"tenant",is_active:true,role:"staff"},tenant:{id:"tenant"},branches:[{id:"branch",tenant_id:"tenant",is_active:true}],permissions:["pos_fnb.send_kitchen"],scope:[{branch_id:"branch"}]});
function client(data:unknown,error:unknown=null){const rpc=vi.fn().mockResolvedValue({data,error});return {rpc,client:{rpc} as unknown as SupabaseClient<Database>};}
describe("fresh current-user bootstrap",()=>{
  it("uses exactly one RPC without accepting a caller-supplied user ID",async()=>{
    const c=client(fixture());expect((await readAuthBootstrap(c.client,"user"))?.permissions).toEqual(["pos_fnb.send_kitchen"]);
    expect(c.rpc).toHaveBeenCalledExactlyOnceWith("get_my_auth_bootstrap");
  });
  it("falls back only when the RPC migration is absent",async()=>{const c=client(null,{code:"PGRST202"});expect(await readAuthBootstrap(c.client,"user")).toBeNull();});
  it.each(["42501","57014","PGRST301",undefined])("does not fan out on read failure %s",async(code)=>{const c=client(null,{code});await expect(readAuthBootstrap(c.client,"user")).rejects.toThrow();expect(c.rpc).toHaveBeenCalledTimes(1);});
  it("accepts genuine empty grants",async()=>{const d=fixture();d.permissions=[];expect((await readAuthBootstrap(client(d).client,"user"))?.permissions).toEqual([]);});
  it("rejects a snapshot for a different identity",async()=>{await expect(readAuthBootstrap(client(fixture()).client,"someone-else")).rejects.toThrow();});
  it("rejects another tenant's branches",async()=>{const d=fixture();d.branches[0].tenant_id="foreign";await expect(readAuthBootstrap(client(d).client,"user")).rejects.toThrow();});
  it("rejects another tenant's metadata",async()=>{const d=fixture();d.tenant.id="foreign";await expect(readAuthBootstrap(client(d).client,"user")).rejects.toThrow();});
  it("rejects malformed or incomplete snapshots",async()=>{for(const d of [null,[],{}, {...fixture(),version:2},{...fixture(),permissions:[null]},{...fixture(),scope:[{}]}]) await expect(readAuthBootstrap(client(d).client,"user")).rejects.toThrow();});
  it("keeps inactive accounts without grants",async()=>{const d=fixture();d.profile.is_active=false;await expect(readAuthBootstrap(client(d).client,"user")).rejects.toThrow(); const closed={...d,tenant:null,permissions:[],branches:[],scope:[]};expect((await readAuthBootstrap(client(closed).client,"user"))?.profile?.is_active).toBe(false);});
  it("accepts missing profile only with no tenant, branches or grants",async()=>{const d={version:1,profile:null,tenant:null,branches:[],permissions:[],scope:[]};expect((await readAuthBootstrap(client(d).client,"user"))?.profile).toBeNull();});
});
