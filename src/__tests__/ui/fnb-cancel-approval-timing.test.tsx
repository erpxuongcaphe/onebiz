import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FnbCancelApprovalTiming, useApprovalClock } from '@/components/shared/fnb-cancel-approval-timing';
import type { CancelApproval } from '@/lib/services/supabase/fnb-cancel-requests';
const approval: CancelApproval={id:'request',order_id:'order',branch_id:'branch',whole_bill:false,items:[],status:'pending',created_at:'2026-10-19T12:00:00Z',server_now:'2026-10-19T12:03:00Z',expires_at:'2026-10-19T12:10:00Z',otp_issued_at:null,otp_expires_at:null};
function Timed({data}:{data:CancelApproval}) { const now=useApprovalClock(data.server_now);return <FnbCancelApprovalTiming approval={data} now={now}/>; }
afterEach(()=>vi.useRealTimers());
describe('server anchored FNB approval timing',()=>{
 it('shows request time and continues the original deadline after reopening, regardless of device clock',()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval','Date','performance']});
  vi.setSystemTime(new Date('2040-01-01T00:00:00Z'));
  const mounted=render(<Timed data={approval}/>);
  expect(screen.getByText(/Xin lúc 19:00:00/)).toBeInTheDocument();
  expect(screen.getByRole('timer')).toHaveTextContent('Còn 7:00');
  act(()=>vi.advanceTimersByTime(2000));
  expect(screen.getByRole('timer')).toHaveTextContent('Còn 6:58');
  vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
  act(()=>vi.advanceTimersByTime(1000));
  expect(screen.getByRole('timer')).toHaveTextContent('Còn 6:57');
  mounted.unmount();
  render(<Timed data={{...approval,server_now:'2026-10-19T12:05:00Z'}}/>);
  expect(screen.getByRole('timer')).toHaveTextContent('Còn 5:00');
 });
 it('warns during the final thirty seconds and changes to expired without waiting for a poll',()=>{
  vi.useFakeTimers({toFake:['setInterval','clearInterval','Date','performance']});
  render(<Timed data={{...approval,status:'issued',server_now:'2026-10-19T12:11:30Z',expires_at:'2026-10-19T12:12:00Z',otp_issued_at:'2026-10-19T12:10:00Z',otp_expires_at:'2026-10-19T12:12:00Z'}}/>);
  expect(screen.getByRole('timer')).toHaveTextContent('Nhập mã trong 0:30');
  expect(screen.getByRole('timer')).toHaveClass('text-status-warning');
  expect(screen.getByText('Cấp mã lúc 19:10:00')).toBeInTheDocument();
  act(()=>vi.advanceTimersByTime(30000));
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  expect(screen.getByText('Mã OTP đã hết hạn · chưa hủy món')).toBeInTheDocument();
 });
});
