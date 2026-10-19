import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelSentItemsDialog } from '@/app/pos/fnb/components/cancel-sent-items-dialog';
import type { ComponentProps } from 'react';
type OtpProps = ComponentProps<typeof import('@/components/shared/dialogs/otp-approval-dialog').OtpApprovalDialog>;
const mocks=vi.hoisted(()=>({ get:vi.fn(), request:vi.fn(), execute:vi.fn(), verifyExecute:vi.fn(), otpProps: null as OtpProps | null }));
vi.mock('@/lib/services/supabase/kitchen-orders',()=>({getKitchenOrderById:mocks.get}));
vi.mock('@/lib/services/supabase/fnb-cancel-requests',()=>({requestFnbCancellation:mocks.request,executeFnbCancellation:mocks.execute,verifyAndExecuteFnbCancellation:mocks.verifyExecute}));
vi.mock('@/components/shared/dialogs/otp-approval-dialog',()=>({OtpApprovalDialog:(p:OtpProps)=>{mocks.otpProps=p;return p.open?<div>{p.contextLabel}</div>:null;}}));
const props={open:true,onOpenChange:vi.fn(),orderId:'order',label:'Bàn 9',wholeBill:false,canCancel:true,onCompleted:vi.fn().mockResolvedValue(undefined)};
beforeEach(()=>{vi.clearAllMocks();mocks.get.mockResolvedValue({status:'ready',items:[{id:'item',productName:'Trà',quantity:3}]});mocks.request.mockResolvedValue({id:'request',order_id:'order',whole_bill:false});mocks.execute.mockResolvedValue({success:true});});
describe('cancel sent quantities in the active POS bill',()=>{
 it('cancels the last item as a whole bill without sending the cashier to a second menu',async()=>{
  mocks.get.mockResolvedValue({status:'ready',items:[{id:'item',productName:'Trà',quantity:1}]});
  mocks.request.mockResolvedValue({id:'request',order_id:'order',whole_bill:true});
  render(<CancelSentItemsDialog {...props} initialItemId="item"/>);
  await screen.findByText(/Bill sẽ được hủy trong lần xác nhận này/);
  fireEvent.change(screen.getByPlaceholderText('Khách đổi món, nhập nhầm…'),{target:{value:'Nhập nhầm'}});
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận hủy'}));
  await waitFor(()=>expect(props.onCompleted).toHaveBeenCalledWith(true,'order'));
  expect(mocks.request).toHaveBeenCalledWith('order',[{id:'item',quantity:1}],'Nhập nhầm',true);
 });
 it('uses the returned whole-bill scope and atomic OTP execution for an employee',async()=>{
  mocks.get.mockResolvedValue({status:'ready',items:[{id:'item',productName:'Trà',quantity:1}]});
  mocks.request.mockResolvedValue({id:'request',order_id:'order',whole_bill:true});
  mocks.verifyExecute.mockResolvedValue({otpId:'otp'});
  render(<CancelSentItemsDialog {...props} canCancel={false} initialItemId="item" shiftId="shift"/>);
  await screen.findByLabelText('Số lượng hủy Trà');
  fireEvent.change(screen.getByPlaceholderText('Khách đổi món, nhập nhầm…'),{target:{value:'Nhập nhầm'}});
  fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu · nhập OTP'}));
  await screen.findByText(/Quản lý mở Cấp OTP/);
  expect(mocks.otpProps?.actionCode).toBe('fnb.cancel_unpaid_bill');
  await mocks.otpProps?.verifyOtp?.({code:'123456',actionCode:'fnb.cancel_unpaid_bill'});
  await act(async()=>{await mocks.otpProps?.onApproved({otpId:'otp',actionCode:'fnb.cancel_unpaid_bill',issuedBy:'manager',issuedByName:'Manager',issuedAt:'',usedAt:''},'');});
  expect(mocks.verifyExecute).toHaveBeenCalledWith('request','123456','shift');
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(props.onCompleted).toHaveBeenCalledWith(true,'order');
 });
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
