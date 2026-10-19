import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FnbCancelApprovalInbox } from '@/components/shared/fnb-cancel-approval-inbox';
import { formatCurrency } from '@/lib/format';
const mocks=vi.hoisted(()=>({pending:vi.fn(),issue:vi.fn(),reject:vi.fn()}));
vi.mock('@/lib/services/supabase/fnb-cancel-requests',()=>({pendingFnbCancellations:mocks.pending,issueFnbCancellationOtp:mocks.issue,rejectFnbCancellation:mocks.reject}));
beforeEach(()=>{vi.clearAllMocks();mocks.pending.mockResolvedValue([{id:'request',order_number:'KB000068',reason:'Nhập nhầm',requested_by_name:'An',items:[{quantity:1,name:'Trà'}],branch_name:'Tư Búa',order_label:'Bàn 9',cancel_net_amount:11000}]);mocks.reject.mockResolvedValue({success:true});});
describe('cancel approval inbox',()=>{
 it.each(['issued','request_expired','otp_expired'])('shows %s with time and prevents another issue while not pending',async status=>{
  mocks.pending.mockResolvedValue([{id:'request',order_number:'KB000068',reason:'Nhập nhầm',requested_by_name:'An',items:[{quantity:1,name:'Trà'}],cancel_net_amount:11000,
   approval:{status,created_at:'2026-10-19T12:00:00Z',server_now:'2026-10-19T12:09:59Z',expires_at:'2026-10-19T12:11:59Z',otp_issued_at:status==='request_expired'?null:'2026-10-19T12:09:59Z'}}]);
  render(<FnbCancelApprovalInbox onIssued={vi.fn()}/>);
  await screen.findByText(/Xin lúc 19:00:00/);
  expect(screen.getByRole('button',{name:status==='issued'?'Đã cấp OTP':'Chờ nhân viên xin lại'})).toBeDisabled();
  if(status==='issued') expect(screen.getByRole('timer')).toHaveTextContent('Nhập mã trong 2:00');
  expect(mocks.issue).not.toHaveBeenCalled();
 });
 it('displays server net amount, requires a reason and rejects the exact request',async()=>{
  render(<FnbCancelApprovalInbox onIssued={vi.fn()}/>);
  await screen.findByText(formatCurrency(11000));
  fireEvent.click(screen.getByRole('button',{name:/^Từ chối$/}));
  expect(screen.getByRole('button',{name:'Xác nhận từ chối'})).toBeDisabled();
  fireEvent.change(screen.getByPlaceholderText('Ghi lý do để nhân viên biết…'),{target:{value:'Chưa hỏi khách'}});
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận từ chối'}));
  await waitFor(()=>expect(mocks.reject).toHaveBeenCalledWith('request','Chưa hỏi khách'));
  expect(mocks.issue).not.toHaveBeenCalled();
 });
 it('does not discard a rejected server operation or claim success',async()=>{
  mocks.reject.mockRejectedValue(new Error('Bill vừa thay đổi'));
  render(<FnbCancelApprovalInbox onIssued={vi.fn()}/>);
  await screen.findByRole('button',{name:/^Từ chối$/});
  fireEvent.click(screen.getByRole('button',{name:/^Từ chối$/}));
  fireEvent.change(screen.getByPlaceholderText('Ghi lý do để nhân viên biết…'),{target:{value:'Chưa hỏi khách'}});
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận từ chối'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Bill vừa thay đổi');
  expect(screen.getByPlaceholderText('Ghi lý do để nhân viên biết…')).toHaveValue('Chưa hỏi khách');
 });
});
