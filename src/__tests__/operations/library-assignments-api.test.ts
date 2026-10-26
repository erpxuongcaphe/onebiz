import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc,auth:{getUser:mocks.getUser}})}));
import { POST } from '@/app/api/operations/library-assignments/route';
const id='11111111-1111-4111-8111-111111111111';
const read={action:'read',id,branchId:id};
const preview={...read,action:'preview',mode:'add',familyIds:[id],managerIds:[id]};
const update={...preview,action:'update',token:'a'.repeat(32),reason:'Thêm quản lý kiểm tra',requestId:id};
const post=(body:unknown,origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/operations/library-assignments',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id}},error:null});mocks.rpc.mockResolvedValue({data:{rows:[]},error:null});});
describe('branch assignment API',()=>{
 it('read and preview call only the read-only RPC',async()=>{
  expect((await POST(post(read))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenLastCalledWith('ops_library_assignments_preview',{p_payload:{id,branchId:id,mode:'read'}});
  expect((await POST(post(preview))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
 });
 it('rejects scope injection, duplicate IDs, empty choices and malformed JSON before a query',async()=>{
  for(const bad of [{...update,tenantId:id},{...preview,managerIds:[]},{...preview,familyIds:[id,id]},{...update,token:'bad'},{...update,reason:' '}])expect((await POST(post(bad))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('keeps auth and same-origin checks for writes',async()=>{
  expect((await POST(post(update,'https://foreign.invalid'))).status).toBe(403);
  mocks.getUser.mockResolvedValue({data:{user:null},error:null});
  expect((await POST(post(update))).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('writes exactly one atomic RPC and does not fall back to repeated individual saves',async()=>{
  expect((await POST(post(update))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('ops_library_assignments_execute',expect.objectContaining({p_request_id:id}));
 });
 it.each([['OPS_ASSIGNMENT_STALE',409],['OPS_FORBIDDEN',403],['OPS_ASSIGNMENT_EMPTY',400],['OPS_INVALID_ASSIGNEE',400],['OPS_REQUEST_CONFLICT',409]])('maps %s without retry',async(message,status)=>{
  mocks.rpc.mockResolvedValue({error:{message},data:null});expect((await POST(post(update))).status).toBe(status);expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it('missing SQL is explicit and never falls back to writing via a different path',async()=>{
  mocks.rpc.mockResolvedValue({error:{message:'missing',code:'PGRST202'},data:null});
  const response=await POST(post(update));expect(response.status).toBe(503);expect((await response.json()).error).toContain('giữ nguyên');expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it('bounds an oversized streaming body',async()=>{
  expect((await POST(post({value:'x'.repeat(31000)}))).status).toBe(413);expect(mocks.rpc).not.toHaveBeenCalled();
 });
});
