import React from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({detail:vi.fn(),change:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/contexts',()=>({useToast:()=>({toast:mocks.toast})}));
vi.mock('@/lib/services/supabase/fnb-warehouse-orders',()=>({getWarehouseOrderForChange:mocks.detail,changeWarehouseOrder:mocks.change}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:{open:boolean;children:React.ReactNode})=>open?<div>{children}</div>:null,DialogContent:({children}:{children:React.ReactNode})=><div>{children}</div>,DialogHeader:({children}:{children:React.ReactNode})=><div>{children}</div>,DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,DialogFooter:({children}:{children:React.ReactNode})=><div>{children}</div>}));
vi.mock('@/components/ui/button',()=>({Button:({variant,children,...p}:React.ButtonHTMLAttributes<HTMLButtonElement>&{variant?:string})=>{void variant;return <button {...p}>{children}</button>;}}));
import {CancelFnbWarehouseOrderDialog} from '@/components/shared/dialogs/cancel-fnb-warehouse-order-dialog';
const fixture={purchaseOrderId:'po',code:'PO1',branchId:'store',warehouseId:'warehouse',revision:3,items:[],note:'Ghi chú nhân viên',blockedReason:null};
beforeEach(()=>{vi.clearAllMocks();mocks.detail.mockReset().mockResolvedValue(fixture);mocks.change.mockReset().mockResolvedValue(undefined);});afterEach(cleanup);
describe('branch demand cancellation',()=>{
 it('requires a reason and cancels both linked documents once after confirmation',async()=>{
  const close=vi.fn(),success=vi.fn();render(<CancelFnbWarehouseOrderDialog orderId="po" onClose={close} onSuccess={success}/>);
  await screen.findByLabelText('Lý do hủy');expect(screen.getByRole('button',{name:'Hủy cả hai đơn'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Lý do hủy'),{target:{value:'Không cần nữa'}});fireEvent.click(screen.getByRole('button',{name:'Hủy cả hai đơn'}));
  await waitFor(()=>expect(success).toHaveBeenCalledTimes(1));expect(close).toHaveBeenCalledTimes(1);expect(mocks.change.mock.calls[0][0]).toMatchObject({purchaseOrderId:'po',expectedRevision:3,action:'cancel',reason:'Không cần nữa'});
  expect(mocks.change.mock.calls[0][0]).not.toHaveProperty('note');
 });
 it('keeps the dialog and request key after an uncertain response',async()=>{
  mocks.change.mockRejectedValueOnce(new Error('Mất kết nối'));const close=vi.fn();render(<CancelFnbWarehouseOrderDialog orderId="po" onClose={close} onSuccess={vi.fn()}/>);
  fireEvent.change(await screen.findByLabelText('Lý do hủy'),{target:{value:'Không cần nữa'}});fireEvent.click(screen.getByRole('button',{name:'Hủy cả hai đơn'}));await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Hủy cả hai đơn'}));await waitFor(()=>expect(mocks.change).toHaveBeenCalledTimes(2));expect(mocks.change.mock.calls[0][0].requestId).toBe(mocks.change.mock.calls[1][0].requestId);
 });
 it('never cancels a dispatched order or one with a warehouse draft in progress',async()=>{
  mocks.detail.mockResolvedValue({...fixture,blockedReason:'Kho đã xuất/giao hàng.'});render(<CancelFnbWarehouseOrderDialog orderId="po" onClose={vi.fn()} onSuccess={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Kho đã xuất');expect(screen.getByRole('button',{name:'Hủy cả hai đơn'})).toBeDisabled();expect(mocks.change).not.toHaveBeenCalled();
 });
 it('prevents duplicate confirmation and closing while cancellation is pending',async()=>{
  mocks.change.mockReturnValue(new Promise(()=>{}));const close=vi.fn();render(<CancelFnbWarehouseOrderDialog orderId="po" onClose={close} onSuccess={vi.fn()}/>);
  fireEvent.change(await screen.findByLabelText('Lý do hủy'),{target:{value:'Không cần nữa'}});fireEvent.click(screen.getByRole('button',{name:'Hủy cả hai đơn'}));fireEvent.click(screen.getByRole('button',{name:'Đang hủy…'}));
  expect(mocks.change).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Giữ phiếu'})).toBeDisabled();expect(close).not.toHaveBeenCalled();
 });
});
