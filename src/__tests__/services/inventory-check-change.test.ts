import {beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:m.rpc})}));
import {applyInventoryCheckChange,previewInventoryCheckChange,InventoryCheckChangeError} from '@/lib/services/supabase/inventory-check-change';
const input={checkId:'check',action:'edit' as const,items:[{productId:'milk',actualStock:18}],note:'',reason:'Recount',sourceVersion:'v1',requestId:'same-request'};
beforeEach(()=>vi.resetAllMocks());
describe('inventory change failure semantics',()=>{
 it('distinguishes a rolled-back stale preview from an unknown network result',async()=>{
  m.rpc.mockResolvedValueOnce({data:null,error:{code:'40001',message:'INVENTORY_CHECK_PREVIEW_STALE'}});
  await expect(applyInventoryCheckChange(input,'token')).rejects.toMatchObject({code:'40001',outcomeUnknown:false});
  m.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(applyInventoryCheckChange(input,'token')).rejects.toMatchObject({outcomeUnknown:true});
 });
 it('treats empty/unconfirmed replies as uncertain and preserves the idempotency key',async()=>{
  m.rpc.mockResolvedValueOnce({data:null,error:null});
  await expect(applyInventoryCheckChange(input,'token')).rejects.toBeInstanceOf(InventoryCheckChangeError);
  m.rpc.mockResolvedValueOnce({data:{applied:true,checkId:'other'},error:null});
  await expect(applyInventoryCheckChange(input,'token')).rejects.toMatchObject({outcomeUnknown:true});
  expect(m.rpc.mock.calls.every(([,args])=>args.p_request_id==='same-request')).toBe(true);
 });
 it('makes busy stock errors actionable and does not mark them as ambiguous commits',async()=>{
  m.rpc.mockResolvedValueOnce({data:null,error:{code:'55P03',message:'could not obtain lock'}});
  await expect(previewInventoryCheckChange(input)).rejects.toMatchObject({outcomeUnknown:false,message:expect.stringContaining('Kho đang có giao dịch')});
 });
});
