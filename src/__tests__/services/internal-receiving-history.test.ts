import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),range:vi.fn(),in:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentTenantId:async()=>'tenant',handleError:(error:Error)=>{throw error;},getClient:()=>({rpc:mocks.rpc,from:()=>{
  const query={select:()=>query,eq:()=>query,in:(...args:unknown[])=>{mocks.in(...args);return query;},order:()=>query,range:mocks.range};return query;
}})}));
import {getInternalReceivingWorkspace} from '@/lib/services/supabase/internal-receiving';
const receipt=(id:string)=>({id,createdAt:'2026-10-20T01:00:00Z',updatedAt:'2026-10-20T01:00:00Z',revision:1,createdBy:'Operator',items:[{itemId:'line',quantity:2}]});
beforeEach(()=>vi.clearAllMocks());
describe('complete receiving unit history',()=>{
  it('reads beyond one metadata page and selects the highest immutable revision',async()=>{
    mocks.rpc.mockResolvedValue({data:[{id:'sale',items:[],receipts:[receipt('r')]}],error:null});
    mocks.range.mockResolvedValueOnce({data:Array.from({length:500},()=>({reference_id:'r',result:{revision:1},snapshots:[{itemId:'line',inputQuantity:2,inputUnit:'Thùng'}]})),error:null})
      .mockResolvedValueOnce({data:[{reference_id:'r',result:{revision:2},snapshots:[{itemId:'line',inputQuantity:24,inputUnit:'Hộp'}]}],error:null});
    const rows=await getInternalReceivingWorkspace('branch');
    expect(mocks.range.mock.calls).toEqual([[0,499],[500,999]]);
    expect(rows[0].receipts[0].items[0].inputQuantity).toBe(24);
  });
  it('batches receipt identifiers without limiting document history',async()=>{
    mocks.rpc.mockResolvedValue({data:[{id:'sale',items:[],receipts:Array.from({length:101},(_,i)=>receipt(String(i)))}],error:null});
    mocks.range.mockResolvedValue({data:[],error:null});
    const rows=await getInternalReceivingWorkspace('branch');
    expect(rows[0].receipts).toHaveLength(101);
    expect(mocks.in.mock.calls.map(call=>call[1].length)).toEqual([100,1]);
  });
});
