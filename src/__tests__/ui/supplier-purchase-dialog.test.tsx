import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({search:vi.fn(),save:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/hooks/use-fnb-catalog-scope',()=>({useFnbCatalogScope:(branch:string)=>branch==='dongxoai'}));
vi.mock('@/lib/contexts',()=>({useToast:()=>({toast:m.toast})}));
vi.mock('@/lib/hooks/use-durable-form-draft',()=>({useDurableFormDraft:()=>({clearDraft:vi.fn(),flushDraft:vi.fn()})}));
vi.mock('@/lib/services/supabase/supplier-purchase-products',()=>({searchSupplierPurchaseProducts:m.search}));
vi.mock('@/lib/services/supabase/uom',()=>({getUOMConversions:async()=>[]}));
vi.mock('@/lib/services/supabase/stock-adjustments',()=>({nextEntityCode:async()=>'PO002'}));
vi.mock('@/lib/services/supabase/purchase-orders',()=>({savePurchaseOrderAtomic:m.save,updateReceivedPurchaseOrderAtomic:vi.fn()}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentContext:async()=>({tenantId:'tenant'}),getClient:()=>({from:(table:string)=>{const q:any={select:()=>q,eq:()=>q,or:()=>q,limit:()=>q,then:(resolve:any)=>Promise.resolve({data:table==='purchase_order_items'?[{product_id:'milk',product_name:'Sữa tươi',unit:'Hộp',quantity:2,unit_price:32000,vat_rate:0,products:{code:'SKU-SUA-001'},note:'Mua NCC ngoài'}]:[],error:null}).then(resolve)};return q;}})}));
import {CreatePurchaseOrderDialog} from '@/components/shared/dialogs/create-purchase-order-dialog';
const editingPO={id:'po',code:'PO001',branchId:'dongxoai',supplierId:'ncc',supplierName:'NCC ngoài',status:'draft' as const};
beforeEach(()=>{vi.clearAllMocks();m.search.mockResolvedValue([{id:'milk',code:'SKU-SUA-001',name:'Sữa tươi',unit:'Hộp',price:32000,vatRate:0}]);m.save.mockResolvedValue({code:'PO001'});});
afterEach(cleanup);
describe('supplier purchase dialog',()=>{
 it('searches SKU in the document branch and preserves line notes through an explicit draft save',async()=>{
  render(<CreatePurchaseOrderDialog open onOpenChange={vi.fn()} editingPO={editingPO}/>);
  const note=await screen.findByLabelText('Ghi chú Sữa tươi');expect(note).toHaveValue('Mua NCC ngoài');
  fireEvent.change(note,{target:{value:'Giao sáng · giữ lạnh'}});
  fireEvent.change(screen.getByLabelText('Tìm mặt hàng nhập NCC theo mã hoặc tên'),{target:{value:'SKU-SUA'}});
  await waitFor(()=>expect(m.search).toHaveBeenCalledWith('SKU-SUA',true));
  expect(m.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi (chờ)'}));
  await waitFor(()=>expect(m.save).toHaveBeenCalledWith(expect.objectContaining({branchId:'dongxoai',receiveNow:false,items:[expect.objectContaining({productId:'milk',quantity:2,unitPrice:32000,note:'Giao sáng · giữ lạnh'})]})));
 });
 it('shows a recoverable search failure without dropping entered rows or notes',async()=>{
  m.search.mockRejectedValue(Error('offline'));render(<CreatePurchaseOrderDialog open onOpenChange={vi.fn()} editingPO={editingPO}/>);
  await screen.findByLabelText('Ghi chú Sữa tươi');
  fireEvent.change(screen.getByLabelText('Tìm mặt hàng nhập NCC theo mã hoặc tên'),{target:{value:'SKU'}});
  expect(await screen.findByText(/Chưa tải được mặt hàng/)).toBeVisible();expect(screen.getByLabelText('Ghi chú Sữa tươi')).toHaveValue('Mua NCC ngoài');expect(m.save).not.toHaveBeenCalled();
 });
});
