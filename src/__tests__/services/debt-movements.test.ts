import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:mocks.rpc})}));
import {getDebtMovements} from '@/lib/services/supabase/debt-movements';
const row={key:'invoice:1',id:'1',kind:'invoice',code:'HD1',date:'2026-10-01',status:'completed',amount:100,delta:100,balance:110,note:'',unmapped:false,created_at:'2026-10-01T00:00:00Z'};
const report={basis:'current_effective_documents',opening:10,increase:100,decrease:0,closing:110,current_net:110,difference:0,unmapped:0,total:1,items:[row]};
beforeEach(()=>vi.clearAllMocks());
describe('debt movement complete source',()=>{
  it('requires an explicit branch and valid date period',async()=>{
    await expect(getDebtMovements('customer','p','','2026-10-01','2026-10-31')).rejects.toThrow('chi nhánh');
    await expect(getDebtMovements('customer','p','b','2026-10-20','2026-10-01')).rejects.toThrow('Ngày');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves server running balances and reconciled period totals',async()=>{
    mocks.rpc.mockResolvedValue({data:report,error:null});
    expect(await getDebtMovements('customer','p','b','2026-10-01','2026-10-31')).toEqual(report);
    expect(mocks.rpc).toHaveBeenCalledWith('get_party_debt_movements',expect.objectContaining({p_mode:'customer',p_party_id:'p',p_branch_id:'b',p_size:200}));
  });
  it('loads all pages, never silently truncates or merges changing balances',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{...report,total:2},error:null}).mockResolvedValueOnce({data:{...report,total:2,items:[{...row,key:'cash:2',id:'2'}]},error:null});
    expect((await getDebtMovements('supplier','p','b','2026-10-01','2026-10-31')).items).toHaveLength(2);
    mocks.rpc.mockResolvedValueOnce({data:{...report,total:2},error:null}).mockResolvedValueOnce({data:{...report,total:2,closing:120},error:null});
    await expect(getDebtMovements('customer','p','b','2026-10-01','2026-10-31')).rejects.toThrow('thay đổi');
  });
  it('rejects duplicate source rows and incomplete paging',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{...report,total:2},error:null}).mockResolvedValueOnce({data:{...report,total:2},error:null});
    await expect(getDebtMovements('customer','p','b','2026-10-01','2026-10-31')).rejects.toThrow('trùng');
    mocks.rpc.mockResolvedValueOnce({data:{...report,total:2},error:null}).mockResolvedValueOnce({data:{...report,total:2,items:[]},error:null});
    await expect(getDebtMovements('customer','p','b','2026-10-01','2026-10-31')).rejects.toThrow('đủ');
  });
});
