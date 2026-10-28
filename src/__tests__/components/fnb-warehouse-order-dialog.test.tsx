import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({context:vi.fn(),submit:vi.fn(),toast:vi.fn(),clear:vi.fn(),draft:vi.fn(),detail:vi.fn(),change:vi.fn()}));
vi.mock('@/lib/hooks/use-product-uom',()=>({useProductUom:()=>({map:new Map(),units:new Map(),loading:false,error:''})}));
vi.mock('@/lib/contexts',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/lib/services/supabase/fnb-warehouse-orders',()=>({getWarehouseOrderContext:mocks.context,submitWarehouseOrder:mocks.submit,getWarehouseOrderForChange:mocks.detail,changeWarehouseOrder:mocks.change}));
vi.mock('@/lib/hooks/use-durable-form-draft',()=>({useDurableFormDraft:(options:unknown)=>{mocks.draft(options);return {clearDraft:mocks.clear};}}));
vi.mock('@/components/ui/dialog',()=>({
 Dialog:({open,children}:{open:boolean;children:React.ReactNode})=>open?<>{children}</>:null,
 DialogContent:({children}:{children:React.ReactNode})=><div role="dialog">{children}</div>,
 DialogHeader:({children}:{children:React.ReactNode})=><div>{children}</div>,
 DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,
 DialogFooter:({children}:{children:React.ReactNode})=><div>{children}</div>,
}));
vi.mock('@/components/ui/input',()=>({Input:(p:React.InputHTMLAttributes<HTMLInputElement>)=><input {...p}/>}));
vi.mock('@/components/ui/button',()=>({Button:({variant,children,...p}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string})=>{void variant;return <button {...p}>{children}</button>;}}));
vi.mock('@/components/ui/numeric-input',()=>({NumericInput:({onChange,decimals,...p}:Omit<React.InputHTMLAttributes<HTMLInputElement>,'onChange'>&{onChange:(n:number)=>void;decimals?:number})=>{void decimals;return <input {...p} type="number" onChange={e=>onChange(Number(e.target.value))}/>;}}));
import { CreateFnbWarehouseOrderDialog } from '@/components/shared/dialogs/create-fnb-warehouse-order-dialog';
const milk={id:'milk',code:'SKU-A',name:'Sữa A',unit:'Thùng'};
const warehouse={id:'warehouse',supplierId:'supplier',name:'Kho tổng'};
async function addMilk(){fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'Sữa'}});fireEvent.click(await screen.findByRole('button',{name:/Sữa A.*SKU-A/}));}
describe('F&B warehouse order form',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();mocks.context.mockImplementation(async(_b:string,search:string)=>({warehouses:[warehouse],products:search?[milk]:[]}));
  mocks.submit.mockResolvedValue({code:'PO1',salesOrderCode:'DH1'});
  mocks.detail.mockReset().mockResolvedValue({purchaseOrderId:'po',code:'PO1',salesOrderCode:'DH1',branchId:'store',warehouseId:'warehouse',revision:2,items:[{...milk,quantity:2,note:'Gói riêng'}],note:'Giao sáng',blockedReason:null});
  mocks.change.mockReset().mockResolvedValue(undefined);
 });
 afterEach(cleanup);
 it('edits existing rows with revision and updates both sides only through the change RPC',async()=>{
  const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store" editingOrderId="po"/>);
  await waitFor(()=>expect(screen.getByLabelText('Số lượng Sữa A')).toHaveValue(2));expect(screen.getByLabelText('Kho cung cấp')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Lưu thay đổi'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Số lượng Sữa A'),{target:{value:'5'}});fireEvent.change(screen.getByLabelText('Ghi chú SKU-A'),{target:{value:'  Nguyên thùng  '}});
  fireEvent.change(screen.getByLabelText('Lý do thay đổi'),{target:{value:'Đổi nhu cầu'}});fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));
  await waitFor(()=>expect(mocks.change).toHaveBeenCalledTimes(1));
  expect(mocks.change.mock.calls[0][0]).toMatchObject({purchaseOrderId:'po',expectedRevision:2,action:'edit',items:[{productId:'milk',unit:'Thùng',expectedFactor:1,quantity:5,note:'  Nguyên thùng  '}],note:'Giao sáng',reason:'Đổi nhu cầu'});
  expect(mocks.submit).not.toHaveBeenCalled();await waitFor(()=>expect(close).toHaveBeenCalledWith(false));
 });
 it('blocks a shipped order and never silently recreates it as a new order',async()=>{
  mocks.detail.mockResolvedValue({purchaseOrderId:'po',code:'PO1',branchId:'store',warehouseId:'warehouse',revision:2,items:[],note:'',blockedReason:'Kho đã xuất/giao hàng.'});
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store" editingOrderId="po"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Kho đã xuất');expect(screen.getByRole('button',{name:'Lưu thay đổi'})).toBeDisabled();expect(mocks.change).not.toHaveBeenCalled();expect(mocks.submit).not.toHaveBeenCalled();
 });
 it('retains edit contents and the same operation key after an uncertain response',async()=>{
  mocks.change.mockRejectedValueOnce(new Error('Mất kết nối'));render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store" editingOrderId="po"/>);
  await screen.findByLabelText('Số lượng Sữa A');fireEvent.change(screen.getByLabelText('Lý do thay đổi'),{target:{value:'Đổi nhu cầu'}});
  fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));await screen.findByRole('alert');expect(screen.getByLabelText('Ghi chú SKU-A')).toHaveValue('Gói riêng');
  fireEvent.click(screen.getByRole('button',{name:'Lưu thay đổi'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledTimes(2));expect(mocks.change.mock.calls[0][0].requestId).toBe(mocks.change.mock.calls[1][0].requestId);
 });
 it('opening and closing never reserves a document number or submits',async()=>{
  const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store"/>);
  await waitFor(()=>expect(screen.getByLabelText('Kho cung cấp')).toHaveValue('warehouse'));
  expect(screen.getByText(/Mã PO cấp khi gửi thành công/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Đóng'}));expect(close).toHaveBeenCalledWith(false);expect(mocks.submit).not.toHaveBeenCalled();
 });
 it('submits quantities, exact employee note and closes only after confirmation',async()=>{
  const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store"/>);await addMilk();
  fireEvent.change(screen.getByLabelText('Số lượng Sữa A'),{target:{value:'6'}});
  fireEvent.change(screen.getByLabelText('Ghi chú SKU-A'),{target:{value:'  Thùng nguyên\nHSD trên 3 tháng  '}});
  fireEvent.change(screen.getByLabelText('Ghi chú cho kho tổng / đề nghị mặt hàng mới'),{target:{value:'Thêm sữa mới\nGiữ lạnh'}});
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0][0]).toMatchObject({branchId:'store',warehouseId:'warehouse',items:[{productId:'milk',unit:'Thùng',expectedFactor:1,quantity:6,note:'  Thùng nguyên\nHSD trên 3 tháng  '}],note:'Thêm sữa mới\nGiữ lạnh'});
  await waitFor(()=>expect(close).toHaveBeenCalledWith(false));expect(mocks.clear).toHaveBeenCalledTimes(1);
 });
 it('failure preserves draft and retries with the same request key',async()=>{
  mocks.submit.mockRejectedValueOnce(new Error('Mất kết nối'));render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);await addMilk();
  fireEvent.change(screen.getByLabelText('Ghi chú SKU-A'),{target:{value:'Đúng mã A'}});
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await screen.findByRole('alert');expect(mocks.clear).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Ghi chú SKU-A')).toHaveValue('Đúng mã A');
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[0][0].requestId).toBe(mocks.submit.mock.calls[1][0].requestId);
  expect(mocks.submit.mock.calls[1][0].items[0].note).toBe('Đúng mã A');
 });
 it('locks duplicate clicks and close while sending',async()=>{
  mocks.submit.mockReturnValue(new Promise(()=>{}));const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store"/>);await addMilk();
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));fireEvent.click(screen.getByRole('button',{name:'Đang gửi…'}));
  expect(mocks.submit).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Đóng'})).toBeDisabled();expect(close).not.toHaveBeenCalled();
 });
 it('requires a warehouse selection if more than one is configured',async()=>{
  mocks.context.mockResolvedValue({warehouses:[warehouse,{...warehouse,id:'other',supplierId:'other'}],products:[]});
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);await waitFor(()=>expect(screen.getAllByRole('option')).toHaveLength(3));expect(screen.getByLabelText('Kho cung cấp')).toHaveValue('');
 });
 it('uses a separate durable form scoped to the source branch',()=>{
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  expect(mocks.draft).toHaveBeenCalledWith(expect.objectContaining({form:'fnb-warehouse-purchase-order',branchId:'store'}));
 });
 it('keeps each code note attached through reorder, repeated selection and removal',async()=>{
  const tea={id:'tea',code:'SKU-B',name:'Trà B',unit:'Túi'};
  mocks.context.mockImplementation(async(_b:string,search:string)=>({warehouses:[warehouse],products:search?[milk,tea]:[]}));
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);await addMilk();
  fireEvent.change(screen.getByLabelText('Ghi chú SKU-A'),{target:{value:'Ghi chú A'}});
  fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'Trà'}});
  fireEvent.click(await screen.findByRole('button',{name:/Trà B.*SKU-B/}));
  fireEvent.change(screen.getByLabelText('Ghi chú SKU-B'),{target:{value:'Ghi chú B'}});
  await addMilk();expect(screen.getByLabelText('Ghi chú SKU-A')).toHaveValue('Ghi chú A');
  fireEvent.click(screen.getByRole('button',{name:'Bỏ Sữa A'}));
  expect(screen.getByLabelText('Ghi chú SKU-B')).toHaveValue('Ghi chú B');
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0][0].items).toEqual([{productId:'tea',unit:'Túi',expectedFactor:1,quantity:1,note:'Ghi chú B'}]);
 });
 it('restores legacy drafts without line notes and includes new notes in its durable snapshot',async()=>{
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  const {act}=await import('@testing-library/react');
  act(()=>mocks.draft.mock.lastCall?.[0].restore({items:[{...milk,quantity:4}],note:'Ghi chú chung',requestId:'old-key',warehouseId:'warehouse'}));
  expect(screen.getByLabelText('Ghi chú SKU-A')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Ghi chú SKU-A'),{target:{value:'Ghi chú mới'}});
  expect(mocks.draft.mock.lastCall?.[0].snapshot.items[0].note).toBe('Ghi chú mới');
 });
 it('does not misreport a failed catalog request as an empty product search',async()=>{
  mocks.context.mockRejectedValue(new Error('Chức năng đặt kho tổng chưa được bật trên môi trường này.'));
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  await screen.findByRole('alert');fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'Sữa'}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('chưa được bật'));
  expect(screen.queryByText(/Không tìm thấy\./)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Gửi đặt hàng'})).toBeDisabled();
 });
 it('labels near results without replacing the query or selecting any SKU',async()=>{
  mocks.context.mockResolvedValue({warehouses:[warehouse],products:[{...milk,matchKind:'near'}]});
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'sau'}});
  expect(await screen.findByText('Gần đúng')).toBeInTheDocument();
  expect(screen.getByLabelText('Thêm hàng cần đặt')).toHaveValue('sau');
  expect(screen.getByRole('button',{name:'Gửi đặt hàng'})).toBeDisabled();
  expect(mocks.submit).not.toHaveBeenCalled();
 });
 it('discards a delayed response after a newer query has completed',async()=>{
  let resolveOld:(value:unknown)=>void=()=>{};
  mocks.context.mockImplementation(async(_b:string,search:string)=>search==='old'?new Promise(resolve=>{resolveOld=resolve;}):{warehouses:[warehouse],products:search==='new'?[milk]:[]});
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'old'}});
  await waitFor(()=>expect(mocks.context).toHaveBeenCalledWith('store','old'));
  fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'new'}});
  await screen.findByRole('button',{name:/Sữa A.*SKU-A/});
  const {act}=await import('@testing-library/react');
  await act(async()=>resolveOld({warehouses:[warehouse],products:[{...milk,id:'stale',name:'Kết quả cũ'}]}));
  expect(screen.queryByText('Kết quả cũ')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:/Sữa A.*SKU-A/})).toBeInTheDocument();
 });
});
