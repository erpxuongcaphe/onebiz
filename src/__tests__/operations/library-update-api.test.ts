import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc,auth:{getUser:mocks.getUser}})}));
import {POST} from '@/app/api/operations/library-update/route';
const id='11111111-1111-4111-8111-111111111111';
const preview={action:'preview',id,version:2,branchIds:[id],effectiveFrom:'2026-10-25'};
const update={...preview,action:'update',requestId:id,token:'a'.repeat(32),reason:'CEO duyệt cập nhật chi nhánh'};
const post=(body:unknown,origin='http://localhost:3000')=>new NextRequest('http://localhost:3000/api/operations/library-update',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id}},error:null});mocks.rpc.mockResolvedValue({data:{token:'a'.repeat(32)},error:null});});
describe('library update API',()=>{
 it('previews using the read-only RPC only',async()=>{
  expect((await POST(post(preview))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('ops_library_update_preview',{p_library:id,p_version:2,p_branches:[id],p_effective:'2026-10-25'});
 });
 it('sends a reviewed explicit update without trusting a caller tenant',async()=>{
  expect((await POST(post({...update,tenantId:id}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  expect((await POST(post(update))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith('ops_library_update_execute',expect.objectContaining({p_request_id:id}));
 });
 it('rejects foreign origins and signed-out users before any RPC',async()=>{
  expect((await POST(post(update,'https://foreign.invalid'))).status).toBe(403);
  mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await POST(post(preview))).status).toBe(401);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(['OPS_LIBRARY_STALE','OPS_LIBRARY_UPDATE_STALE','OPS_LIBRARY_UPDATE_PENDING','OPS_LIBRARY_BRANCH_OVERRIDE','OPS_LIBRARY_UPDATE_NOT_NEEDED'])('does not retry conflicts: %s',async(message)=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message}});expect((await POST(post(update))).status).toBe(409);expect(mocks.rpc).toHaveBeenCalledOnce();
 });
 it('does not fall back to a legacy write when migration is missing',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{message:'missing',code:'PGRST202'}});
  const response=await POST(post(update));expect(response.status).toBe(503);expect((await response.json()).error).toContain('giữ nguyên');expect(mocks.rpc).toHaveBeenCalledOnce();
 });
});
