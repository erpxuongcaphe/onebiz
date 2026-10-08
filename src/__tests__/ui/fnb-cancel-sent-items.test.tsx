import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelSentItemsDialog } from '@/app/pos/fnb/components/cancel-sent-items-dialog';
const mocks=vi.hoisted(()=>({ get:vi.fn(), request:vi.fn(), execute:vi.fn() }));
vi.mock('@/lib/services/supabase/kitchen-orders',()=>({getKitchenOrderById:mocks.get}));
vi.mock('@/lib/services/supabase/fnb-cancel-requests',()=>({requestFnbCancellation:mocks.request,executeFnbCancellation:mocks.execute}));
vi.mock('@/components/shared/dialogs/otp-approval-dialog',()=>({OtpApprovalDialog:({open,contextLabel}:{open:boolean;contextLabel:string})=>open?<div>{contextLabel}</div>:null}));
const props={open:true,onOpenChange:vi.fn(),orderId:'order',label:'Bàn 9',wholeBill:false,canCancel:true,onCompleted:vi.fn().mockResolvedValue(undefined)};
beforeEach(()=>{vi.clearAllMocks();mocks.get.mockResolvedValue({status:'ready',items:[{id:'item',productName:'Trà',quantity:3}]});mocks.request.mockResolvedValue({id:'request',order_id:'order',whole_bill:false});mocks.execute.mockResolvedValue({success:true});});
describe('cancel sent quantities in the active POS bill',()=>{
 it('submits selected quantity and reason once, keeping the original sent line',async()=>{
  render(<CancelSentItemsDialog {...props}/>);
  await screen.findByLabelText('Số lượng hủy Trà');
  fireEvent.change(screen.getByLabelText('Số lượng hủy Trà'),{target:{value:'1'}});
  fireEvent.change(screen.getByPlaceholderText('Khách đổi món, nhập nhầm…'),{target:{value:'Khách đổi món'}});
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy'}));
  fireEvent.click(screen.getByRole('button',{name:'Đang xử lý…'}));
  await waitFor(()=>expect(props.onCompleted).toHaveBeenCalledTimes(1));
  expect(mocks.request).toHaveBeenCalledWith('order',[{id:'item',quantity:1}],'Khách đổi món',false);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
 });
 it('rejects fractional quantities and does not hide a load error',async()=>{
  render(<CancelSentItemsDialog {...props}/>);
  await screen.findByLabelText('Số lượng hủy Trà');
  fireEvent.change(screen.getByLabelText('Số lượng hủy Trà'),{target:{value:'0.5'}});
  fireEvent.change(screen.getByPlaceholderText('Khách đổi món, nhập nhầm…'),{target:{value:'Nhập nhầm'}});
  expect(screen.getByRole('button',{name:'Xác nhận hủy'})).toBeDisabled();
 });
 it('creates a prefilled approval request for an employee without cancellation permission',async()=>{
  render(<CancelSentItemsDialog {...props} canCancel={false}/>);
  await screen.findByLabelText('Số lượng hủy Trà');
  fireEvent.change(screen.getByLabelText('Số lượng hủy Trà'),{target:{value:'1'}});
  fireEvent.change(screen.getByPlaceholderText('Khách đổi món, nhập nhầm…'),{target:{value:'Nhập nhầm'}});
  fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu · nhập OTP'}));
  await screen.findByText(/Quản lý mở Cấp OTP/);
  expect(mocks.execute).not.toHaveBeenCalled();
 });
});
