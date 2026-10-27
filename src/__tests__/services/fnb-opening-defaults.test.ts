import {beforeEach,expect,it,vi} from 'vitest';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getClient:()=>({rpc})}));
import {getOpeningWarehousePrices,openingError} from '@/lib/services/supabase/opening-stock';
import {getFnbNewStoreDefault,saveFnbNewStoreDefault} from '@/lib/services/supabase/fnb-new-store-defaults';
beforeEach(()=>rpc.mockReset());
it('requests quotes once per distinct product and normalizes numeric results without replacing null',async()=>{
 rpc.mockResolvedValue({data:[{productId:'p',unit:'Cây',costPrice:'85000.000000'},{productId:'b',unit:'G',costPrice:null}],error:null});
 expect(await getOpeningWarehousePrices('branch',['p','p','b'])).toEqual([{productId:'p',unit:'Cây',costPrice:85000},{productId:'b',unit:'G',costPrice:null}]);
 expect(rpc).toHaveBeenCalledExactlyOnceWith('get_inventory_opening_warehouse_prices',{p_branch_id:'branch',p_product_ids:['p','b']});
});
it('never widens or retries quote requests after missing setup or permission failure',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'OPENING_FNB_SETUP_REQUIRED'}});
 await expect(getOpeningWarehousePrices('branch',['p'])).rejects.toThrow('sổ giá vốn riêng');expect(rpc).toHaveBeenCalledTimes(1);
 expect(openingError('OPENING_SHARED_COST_CONFLICT: SKU-A').message).toContain('Hàng cấp F&B');
 expect(openingError('OPENING_SHARED_COST_CONFLICT: SKU-A').message).toContain('SKU-A');
});
it('fails closed on malformed defaults or quotes',async()=>{
 rpc.mockResolvedValue({data:null,error:null});await expect(getOpeningWarehousePrices('b',['p'])).rejects.toThrow('Giá đã nhập được giữ nguyên');
 await expect(getFnbNewStoreDefault()).rejects.toThrow('Chưa lưu/đọc');
});
it('explicitly clears the template when disabling future defaults',async()=>{
 rpc.mockResolvedValue({data:{enabled:false,templateBranchId:null},error:null});
 await saveFnbNewStoreDefault({enabled:false,templateBranchId:'old'});
 expect(rpc).toHaveBeenCalledWith('set_fnb_new_store_cost_default',expect.objectContaining({p_enabled:false,p_template_branch_id:null}));
});
it('reports stale template clearly without changing branch creation input',async()=>{
 rpc.mockResolvedValue({data:null,error:{message:'FNB_DEFAULT_TEMPLATE_REQUIRED'}});
 await expect(saveFnbNewStoreDefault({enabled:true,templateBranchId:'old'})).rejects.toThrow('đổi quán mẫu');
 expect(rpc).toHaveBeenCalledTimes(1);
});
