import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({rpc:mocks.rpc,auth:{getUser:mocks.getUser}}) }));
import { GET as people } from "@/app/api/operations/people/route";
import { GET as batches, POST as save } from "@/app/api/operations/workbook/route";
import { ceoWorkingRows } from "@/lib/operations/workbook-import";
const id="11111111-1111-4111-8111-111111111111";
const body=()=>({requestId:crypto.randomUUID(),rows:ceoWorkingRows.map(row=>({...row,...(row.frequency==='weekly'?{dayNumber:row.number===32?1:5}:{})})),assignments:[{branchId:id,assigneeId:id}],effectiveFrom:"2026-10-16",dueTime:"17:30",weeklyDay:1});
const post=(value:unknown,origin="http://localhost:3000")=>new NextRequest('http://localhost:3000/api/operations/workbook',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id}},error:null});mocks.rpc.mockImplementation(async(name:string)=>({data:name==='ops_access_context'?{recurrenceVersion:1}:[],error:null}));});
describe('branch user options and atomic work import API',()=>{
 it('authenticates the picker and delegates only validated branch/purpose to the read RPC',async()=>{
  const response=await people(new NextRequest(`http://localhost:3000/api/operations/people?branch=${id}&purpose=manager`));
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
  expect(mocks.rpc).toHaveBeenCalledWith('ops_eligible_people',{p_branch:id,p_purpose:'manager'});
 });
 it('rejects invalid purposes without any query',async()=>{expect((await people(new NextRequest(`http://localhost:3000/api/operations/people?branch=${id}&purpose=all`))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('does not fall back to a company-wide people list after access failure',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'OPS_FORBIDDEN'}});expect((await people(new NextRequest(`http://localhost:3000/api/operations/people?branch=${id}&purpose=manager`))).status).toBe(403);expect(mocks.rpc).toHaveBeenCalledOnce();});
 it('requires sign-in for both options and saved batches',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await people(new NextRequest(`http://localhost:3000/api/operations/people?branch=${id}&purpose=manager`))).status).toBe(401);expect((await batches()).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('rejects cross-origin writes',async()=>{expect((await save(post(body(),'https://other.invalid'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('requires explicit valid users and unique branch assignments',async()=>{const invalid=body();invalid.assignments[0].assigneeId='';expect((await save(post(invalid))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('saves 34 source works in one database transaction and never approves by default',async()=>{const value=body();expect((await save(post(value))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('ops_workbook_import_v2',expect.objectContaining({p_request_id:value.requestId,p_activate:false}));expect(mocks.rpc).toHaveBeenCalledTimes(2);});
 it('activation has a separate explicit request',async()=>{expect((await save(post({requestId:id,activate:true}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('ops_workbook_import_v2',{p_request_id:id,p_body:null,p_activate:true});});
 it('keeps all selected managers for the legacy Excel screen',async()=>{
  const other='22222222-2222-4222-8222-222222222222';const value={...body(),assignments:[{branchId:id,assigneeIds:[id,other]}]};
  expect((await save(post(value))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('ops_workbook_import_v2',expect.objectContaining({p_body:expect.objectContaining({assignments:value.assignments})}));
  mocks.rpc.mockClear();expect((await save(post({...value,assignments:[{branchId:id,assigneeIds:[id,id]}]}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('requires a reason for discarding a draft',async()=>{expect((await save(post({requestId:id,discard:true,reason:''}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('reports duplicate import as conflict and does not retry',async()=>{mocks.rpc.mockImplementation(async(name:string)=>name==='ops_access_context'?{data:{recurrenceVersion:1},error:null}:{data:null,error:{message:'OPS_WORKBOOK_DUPLICATE'}});expect((await save(post(body()))).status).toBe(409);expect(mocks.rpc).toHaveBeenCalledTimes(2);});
 it('requires individual weekly days before saving a new Excel draft',async()=>{expect((await save(post({...body(),rows:ceoWorkingRows}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
});
