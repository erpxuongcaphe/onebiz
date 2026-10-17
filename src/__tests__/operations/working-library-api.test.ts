import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc,auth:{getUser:mocks.getUser}})}));
import { GET,POST } from '@/app/api/operations/library/route';
import { libraryCommandSchema } from '@/lib/operations/working-library';
import { ceoWorkingRows } from '@/lib/operations/workbook-import';
const id='11111111-1111-4111-8111-111111111111';
const command=()=>({action:'save',requestId:crypto.randomUUID(),id:null,version:null,title:'Bộ CEO',rows:ceoWorkingRows,notes:'',sourceKey:'ceo-working-20261014',reason:'Lưu bộ tiêu chí CEO'});
const post=(body:unknown,origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/operations/library',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id}},error:null});mocks.rpc.mockResolvedValue({data:{libraries:[],applications:[]},error:null});});
describe('shared working library API',()=>{
 it('blocks new schedules without the database capability and does not attempt a write',async()=>{
  const body={...command(),rows:[{...ceoWorkingRows[0],frequency:'quarterly',dayNumber:31,monthNumber:2}]};
  expect((await POST(post(body))).status).toBe(503);
  expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.rpc).toHaveBeenCalledWith('ops_working_library_read',{});
  mocks.rpc.mockReset();mocks.rpc.mockResolvedValueOnce({data:{recurrenceVersion:1},error:null}).mockResolvedValueOnce({data:{id},error:null});
  expect((await POST(post(body))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith('ops_working_library_execute',expect.objectContaining({p_action:'save',p_payload:expect.objectContaining({rows:body.rows})}));
 });
 it('saves 34 definitions without any branch, person or schedule',async()=>{
  const body=command();expect((await POST(post(body))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith('ops_working_library_execute',{p_action:'save',p_request_id:body.requestId,p_payload:expect.objectContaining({id:null,version:null,rows:ceoWorkingRows})});
  expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it('reads a private noncached company library only after sign-in',async()=>{const r=await GET();expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toContain('no-store');expect(mocks.rpc).toHaveBeenCalledWith('ops_working_library_read',{});});
 it('requires login for reads and writes',async()=>{mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await GET()).status).toBe(401);expect((await POST(post(command()))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('rejects foreign origins before any RPC',async()=>{expect((await POST(post(command(),'https://foreign.invalid'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('does not trust caller tenant, owner or branch access claims',async()=>{expect((await POST(post({...command(),tenantId:id,isCeo:true}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('allows edited, removed and added rows rather than locking to 34',()=>{const body=command();body.rows=[{...ceoWorkingRows[0],number:99,title:'CEO tùy chỉnh'}];expect(libraryCommandSchema.safeParse(body).success).toBe(true);});
 it('requires an exact version on update and unique row numbers',async()=>{expect((await POST(post({...command(),id,version:null}))).status).toBe(400);expect((await POST(post({...command(),rows:[ceoWorkingRows[0],ceoWorkingRows[0]]}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
 it('requires complete independent schedules for every selected branch',async()=>{
  const body={action:'apply',requestId:id,id,version:1,assignments:[{branchId:id,assigneeId:id,effectiveFrom:'2026-10-17',dueTime:'17:30',weeklyDay:1}]};
  expect((await POST(post(body))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('ops_working_library_execute_v2',expect.objectContaining({p_action:'apply'}));mocks.rpc.mockClear();
  expect((await POST(post({...body,assignments:[body.assignments[0],body.assignments[0]]}))).status).toBe(400);expect((await POST(post({...body,assignments:[{...body.assignments[0],assigneeId:''}]}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('preserves all managers and rejects empty, repeated or ambiguous selections',async()=>{
  const other='22222222-2222-4222-8222-222222222222';
  const schedule={branchId:id,assigneeIds:[id,other],effectiveFrom:'2026-10-20',dueTime:'17:30',weeklyDay:1};
  const body={action:'apply',requestId:crypto.randomUUID(),id,version:1,assignments:[schedule]};
  expect((await POST(post(body))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith('ops_working_library_execute_v2',expect.objectContaining({p_payload:expect.objectContaining({assignments:[schedule]})}));
  mocks.rpc.mockClear();
  for(const assignment of [{...schedule,assigneeIds:[]},{...schedule,assigneeIds:[id,id]},{...schedule,assigneeId:id}]) expect((await POST(post({...body,assignments:[assignment]}))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('does not fall back to the single-manager RPC when migration is missing',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'function missing'}});
  const response=await POST(post({action:'apply',requestId:id,id,version:1,assignments:[{branchId:id,assigneeIds:[id],effectiveFrom:'2026-10-20',dueTime:'17:30',weeklyDay:1}]}));
  expect(response.status).toBe(503);expect((await response.json()).error).toContain('giữ nguyên');expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it.each(['OPS_LIBRARY_STALE','OPS_LIBRARY_EXISTS','OPS_LIBRARY_APPLIED','OPS_WORKBOOK_DUPLICATE'])('shows a conflict without retrying %s',async(message)=>{mocks.rpc.mockResolvedValue({data:null,error:{message}});expect((await POST(post(command()))).status).toBe(409);expect(mocks.rpc).toHaveBeenCalledOnce();});
 it('requires a reason before archiving, and never issues delete directly',async()=>{expect((await POST(post({action:'archive',requestId:id,id,version:1,reason:''}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
});
