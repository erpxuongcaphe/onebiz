import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc:mocks.rpc})}));
import {prepareFinanceImport,previewFinanceImport,commitFinanceImport} from '@/lib/services/supabase/finance-import';
import {financeImportSchema,type FinanceImportRow} from '@/lib/excel/schemas/management-finance';
const row:FinanceImportRow={sourceSystem:'EXT',sourceCode:'CP1',operation:'record',categoryCode:'CP-DIEN',counterparty:'Utility',amount:1000,businessDate:'2026-09-01',recognitionDate:'2026-09-30'};
const categories=[{id:'cat',code:'CP-DIEN',name:'Điện',kind:'expense' as const,is_group:false,parent_id:'parent'}];
beforeEach(()=>vi.clearAllMocks());
describe('external financial import',()=>{
  it('separates recognition dates and unpaid posting from cash',()=>{
    expect(prepareFinanceImport([row],'branch','',categories)[0].payload).toMatchObject({businessDate:'2026-09-01',allocations:[{recognitionDate:'2026-09-30',branchId:'branch',amount:1000}]});
    expect(prepareFinanceImport([row],'branch','',categories)[0].payload).not.toHaveProperty('payment');
  });
  it('retains original source identity regardless of amount and file order',()=>{
    expect(prepareFinanceImport([{...row,amount:2000}],'branch','',categories)[0]).toMatchObject({sourceSystem:'EXT',sourceCode:'CP1'});
    expect(()=>prepareFinanceImport([row,row],'branch','',categories)).toThrow('trùng');
  });
  it('rejects group categories, invalid dates and payment greater than recognition',()=>{
    expect(()=>prepareFinanceImport([row],'branch','',[{...categories[0],is_group:true}])).toThrow('khoản mục');
    expect(()=>prepareFinanceImport([{...row,businessDate:'2026-02-30'}],'branch','',categories)).toThrow('ngày');
    expect(()=>prepareFinanceImport([{...row,paymentAmount:1001}],'branch','person',categories)).toThrow('vượt');
  });
  it('routes trade payments separately, not to new expense/revenue',()=>{
    const trade:FinanceImportRow={sourceSystem:'EXT',sourceCode:'PC1',operation:'purchase_order',referenceCode:'NH1',amount:200,transactionDate:'2026-10-01',occurredAt:'2026-10-01T09:00:00+07:00',paymentMethod:'bank_transfer'};
    const request=prepareFinanceImport([trade],'branch','person',categories)[0];
    expect(request).toMatchObject({operation:'purchase_order',referenceCode:'NH1',payload:{amount:200,performedBy:'person',transactionDate:'2026-10-01'}});
    expect(request.payload).not.toHaveProperty('categoryId');
    expect(()=>prepareFinanceImport([trade],'branch','',categories)).toThrow('người');
    expect(financeImportSchema.validateRow?.({...trade,occurredAt:'2026-10-01T09:00:00'},0,[trade])).toContain('múi giờ');
  });
  it('uses only the atomic import RPC and rejects incomplete confirmation',async()=>{
    const requests=prepareFinanceImport([row],'branch','',categories);
    mocks.rpc.mockResolvedValueOnce({data:[{sourceCode:'CP1',state:'new'}],error:null});
    await previewFinanceImport(requests);
    expect(mocks.rpc).toHaveBeenCalledWith('preview_management_finance_import',{p_rows:requests});
    mocks.rpc.mockResolvedValueOnce({data:[{state:'new'}],error:null});
    expect(await commitFinanceImport(requests)).toMatchObject({successCount:1,failureCount:0});
    mocks.rpc.mockResolvedValueOnce({data:[],error:null});
    await expect(commitFinanceImport(requests)).rejects.toThrow('Chưa xác nhận');
    expect(mocks.rpc).toHaveBeenLastCalledWith('commit_management_finance_import',{p_rows:requests});
  });
});
