import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({load:vi.fn(),submit:vi.fn(),rpc:vi.fn(),toast:vi.fn(),branch:{id:'branch',branchType:'store'},branches:[{id:'branch',branchType:'store'}]}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:'branch',currentBranch:m.branch,branches:m.branches}),useToast:()=>({toast:m.toast})}));
vi.mock('@/lib/hooks/use-durable-form-draft',()=>({useDurableFormDraft:()=>({clearDraft:vi.fn(),flushDraft:vi.fn()})}));
vi.mock('@/lib/services/supabase/document-copy',()=>({loadDocumentCopy:m.load}));
vi.mock('@/lib/services/supabase/fnb-branch-cost',()=>({getFnbBranchComponentCosts:async()=>new Map()}));
vi.mock('@/lib/services/supabase/uom',()=>({getUOMConversions:async()=>[],getUOMConversionsByProductIds:async()=>new Map()}));
vi.mock('@/lib/services/supabase/rpc-utils',()=>({isRpcUnavailable:()=>false}));
vi.mock('@/lib/services/supabase/base',()=>({getCurrentContext:async()=>({tenantId:'tenant',branchId:'branch'}),getClient:()=>({rpc:m.rpc,from:()=>{const q={select:()=>q,eq:()=>q,is:()=>q,in:()=>q,limit:async()=>({data:[{product_id:'milk',quantity:7}],error:null})};return q;}})}));
vi.mock('@/lib/services/supabase/fnb-warehouse-orders',()=>({getWarehouseOrderContext:async()=>({warehouses:[{id:'warehouse',name:'Kho tổng',supplierId:'supplier'}],products:[]}),submitWarehouseOrder:m.submit}));
import {CreateFnbWarehouseOrderDialog} from '@/components/shared/dialogs/create-fnb-warehouse-order-dialog';
import {CreateInventoryCheckDialog} from '@/components/shared/dialogs/create-inventory-check-dialog';
const source={id:'old',code:'PO001',branchId:'branch'};
const item={id:'milk',code:'SKU-SUA',name:'Sữa',unit:'G',cost_price:10,quantity:3,price:20,vatRate:0,note:'Lô mới'};
beforeEach(()=>{vi.clearAllMocks();m.load.mockResolvedValue({code:'PO001',supplier:{id:'supplier',name:'Kho tổng',branchId:'warehouse'},items:[item],note:'Giao sáng'});m.submit.mockResolvedValue({code:'PO002',salesOrderCode:'DH002'});m.rpc.mockResolvedValue({data:{check_id:'new-check',code:'KK002',status:'balanced'},error:null});});
afterEach(cleanup);
describe('copy document workflow',()=>{
 it('previews quantities and literal notes without sending anything, then sends with a fresh request key',async()=>{
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="branch" copySource={source}/>);
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Số lượng Sữa'})).toHaveValue('3'));
  expect(screen.getByRole('textbox',{name:'Ghi chú SKU-SUA'})).toHaveValue('Lô mới');expect(m.submit).not.toHaveBeenCalled();
  const button=screen.getByRole('button',{name:'Gửi đặt hàng'});await waitFor(()=>expect(button).toBeEnabled());
  await act(async()=>{fireEvent.click(button);fireEvent.click(button);});
  expect(m.submit).toHaveBeenCalledTimes(1);expect(m.submit.mock.calls[0][0]).toMatchObject({branchId:'branch',warehouseId:'warehouse',items:[{productId:'milk',quantity:3,note:'Lô mới'}]});
  expect(m.submit.mock.calls[0][0].requestId).not.toBe('old');
 });
 it('does not send an empty or partial order after copy failure',async()=>{
  m.load.mockRejectedValue(new Error('Hàng đã ngừng dùng'));render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="branch" copySource={source}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Hàng đã ngừng dùng');expect(screen.getByRole('button',{name:'Gửi đặt hàng'})).toBeDisabled();expect(m.submit).not.toHaveBeenCalled();
 });
 it('requires fresh physical counts and reads current branch stock before any inventory posting',async()=>{
  m.load.mockResolvedValue({code:'KK001',items:[item],note:'',supplier:null});
  render(<CreateInventoryCheckDialog open onOpenChange={vi.fn()} copySource={{...source,code:'KK001'}}/>);
  const input=await screen.findByPlaceholderText('Chưa kiểm');expect(input).toHaveValue('');expect(m.rpc).not.toHaveBeenCalled();
  const save=screen.getByRole('button',{name:/Hoàn thành|Cân bằng|Lưu/});fireEvent.click(save);
  expect(await screen.findByText(/Nhập số thực đếm cho tất cả/)).toBeVisible();expect(m.rpc).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:'6'}});await act(async()=>fireEvent.click(save));
  expect(m.rpc).toHaveBeenCalledTimes(1);expect(m.rpc.mock.calls[0][1].p_items[0]).toMatchObject({product_id:'milk',quantity:6,inputUnit:'G'});
 });
});
