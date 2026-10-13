import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocked=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:mocked.rpc}),handleError:(e:{message:string})=>{throw new Error(e.message);}}));
import {getAllPartyCashHistory,getPartyCashHistory} from '@/lib/services/supabase/cash-book';
beforeEach(()=>{vi.clearAllMocks();mocked.rpc.mockResolvedValue({data:{items:[],total:0},error:null});});
describe('party cash history source RPC',()=>{
 it('passes exact identity, branch and filters without guessing by name',async()=>{
  const filters={search:'%_, note',dateFrom:'2026-09-01',dateTo:'2026-09-30',sortBy:'amount' as const,ascending:true};
  await getPartyCashHistory('supplier','supplier','branch',1,filters);
  expect(mocked.rpc).toHaveBeenCalledWith('get_party_cash_history_sources',{p_mode:'supplier',p_party_id:'supplier',p_branch_id:'branch',p_page:1,p_size:25,p_filters:filters});
 });
 it('maps a legacy null-party voucher and retains cancellation and cash timing',async()=>{
  mocked.rpc.mockResolvedValue({data:{total:1,items:[{id:'legacy',code:'CA1',amount:1234.56,status:'cancelled',transaction_date:'2026-09-01',occurred_at:'2026-09-02T00:00:00Z',profiles:{full_name:'Actor'},branches:{name:'Kho Tổng'}}]},error:null});
  const r=await getPartyCashHistory('customer','customer',null);
  expect(r.data[0]).toMatchObject({id:'legacy',status:'cancelled',date:'2026-09-01',amount:1234.56,createdByName:'Actor',branchName:'Kho Tổng'});
 });
 it('does not hide denied access or invalid server data as empty',async()=>{
  mocked.rpc.mockResolvedValueOnce({error:{message:'permission denied'},data:null});
  await expect(getPartyCashHistory('customer','customer')).rejects.toThrow('permission denied');
  mocked.rpc.mockResolvedValueOnce({error:null,data:null});
  await expect(getPartyCashHistory('customer','customer')).rejects.toThrow('dữ liệu hợp lệ');
 });
 it('exports all pages and rejects partial/duplicate history',async()=>{
  const first=Array.from({length:1000},(_,i)=>({id:`cash-${i}`,amount:i}));
  mocked.rpc.mockResolvedValueOnce({error:null,data:{items:first,total:1001}}).mockResolvedValueOnce({error:null,data:{items:[{id:'last',amount:1}],total:1001}});
  expect(await getAllPartyCashHistory('supplier','supplier','branch')).toHaveLength(1001);
  mocked.rpc.mockResolvedValueOnce({error:null,data:{items:first,total:1001}}).mockResolvedValueOnce({error:null,data:{items:[],total:1001}});
  await expect(getAllPartyCashHistory('supplier','supplier','branch')).rejects.toThrow('chưa tải đủ');
  mocked.rpc.mockResolvedValueOnce({error:null,data:{items:first,total:1001}}).mockResolvedValueOnce({error:null,data:{items:[{id:'cash-1'}],total:1001}});
  await expect(getAllPartyCashHistory('supplier','supplier','branch')).rejects.toThrow('bị trùng');
 });
});
