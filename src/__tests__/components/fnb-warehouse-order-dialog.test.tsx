import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
const mocks=vi.hoisted(()=>({context:vi.fn(),submit:vi.fn(),toast:vi.fn(),clear:vi.fn(),draft:vi.fn()}));
vi.mock('@/lib/contexts',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/lib/services/supabase/fnb-warehouse-orders',()=>({getWarehouseOrderContext:mocks.context,submitWarehouseOrder:mocks.submit}));
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
 });
 afterEach(cleanup);
 it('opening and closing never reserves a document number or submits',async()=>{
  const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store"/>);
  await waitFor(()=>expect(screen.getByLabelText('Kho cung cấp')).toHaveValue('warehouse'));
  expect(screen.getByText(/Mã PO cấp khi gửi thành công/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Đóng'}));expect(close).toHaveBeenCalledWith(false);expect(mocks.submit).not.toHaveBeenCalled();
 });
 it('submits quantities, exact employee note and closes only after confirmation',async()=>{
  const close=vi.fn();render(<CreateFnbWarehouseOrderDialog open onOpenChange={close} branchId="store"/>);await addMilk();
  fireEvent.change(screen.getByLabelText('Số lượng Sữa A'),{target:{value:'6'}});
  fireEvent.change(screen.getByLabelText('Ghi chú cho kho tổng / đề nghị mặt hàng mới'),{target:{value:'Thêm sữa mới\nGiữ lạnh'}});
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(1));
  expect(mocks.submit.mock.calls[0][0]).toMatchObject({branchId:'store',warehouseId:'warehouse',items:[{productId:'milk',quantity:6}],note:'Thêm sữa mới\nGiữ lạnh'});
  await waitFor(()=>expect(close).toHaveBeenCalledWith(false));expect(mocks.clear).toHaveBeenCalledTimes(1);
 });
 it('failure preserves draft and retries with the same request key',async()=>{
  mocks.submit.mockRejectedValueOnce(new Error('Mất kết nối'));render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);await addMilk();
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await screen.findByRole('alert');expect(mocks.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Gửi đặt hàng'}));await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[0][0].requestId).toBe(mocks.submit.mock.calls[1][0].requestId);
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
 it('does not misreport a failed catalog request as an empty product search',async()=>{
  mocks.context.mockRejectedValue(new Error('Chức năng đặt kho tổng chưa được bật trên môi trường này.'));
  render(<CreateFnbWarehouseOrderDialog open onOpenChange={vi.fn()} branchId="store"/>);
  await screen.findByRole('alert');fireEvent.change(screen.getByLabelText('Thêm hàng cần đặt'),{target:{value:'Sữa'}});
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('chưa được bật'));
  expect(screen.queryByText(/Không tìm thấy\./)).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Gửi đặt hàng'})).toBeDisabled();
 });
});
