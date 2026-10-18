import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OtpApprovalDialog } from '@/components/shared/dialogs/otp-approval-dialog';
const m=vi.hoisted(()=>({request:vi.fn(),status:vi.fn(),verify:vi.fn()}));
vi.mock('@/lib/services/supabase/manager-approval',()=>({requestManagerApproval:m.request,getManagerApproval:m.status}));
vi.mock('@/lib/services/supabase/manager-otp',()=>({verifyAndUseManagerOtp:m.verify,OTP_ACTION_LABELS:{'fnb.discount_override':'Giảm giá FnB'}}));
beforeEach(()=>{vi.clearAllMocks();m.request.mockResolvedValue({id:'request1'});m.verify.mockResolvedValue({otpId:'otp1'});});
function mount(onApproved=vi.fn(),meta:Record<string,unknown>={branch_id:'b1',draft_key:'draft1',amount:100000,items:[]}){
 const close=vi.fn();render(<OtpApprovalDialog open onOpenChange={close} actionCode="fnb.discount_override" targetMeta={meta} requireReason onApproved={onApproved}/>);return{close,onApproved};
}
function reason(){fireEvent.change(screen.getByPlaceholderText('VD: Khách đổi ý, đặt nhầm món, khách bỏ về...'),{target:{value:'Khách phản ánh chất lượng'}});}
async function send(){reason();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu duyệt'}));await screen.findByRole('status');}
function paste(){fireEvent.paste(screen.getByRole('textbox',{name:'Chữ số OTP 1'}),{clipboardData:{getData:()=> '123456'}});}
describe('persisted manager approval request',()=>{
 it('does not accept an OTP before the request has actually been saved',()=>{mount();reason();expect(screen.getByRole('textbox',{name:'Chữ số OTP 1'})).toBeDisabled();expect(screen.getByRole('button',{name:'Xác nhận'})).toBeDisabled();expect(m.verify).not.toHaveBeenCalled();});
 it('sends exact intent and reason, then verifies the returned request identity',async()=>{const {onApproved}=mount();await send();expect(m.request).toHaveBeenCalledWith('fnb.discount_override',expect.objectContaining({draft_key:'draft1',branch_id:'b1',amount:100000}),'Khách phản ánh chất lượng');paste();fireEvent.click(screen.getByRole('button',{name:'Xác nhận'}));await waitFor(()=>expect(onApproved).toHaveBeenCalledOnce());expect(m.verify).toHaveBeenCalledWith(expect.objectContaining({targetMeta:expect.objectContaining({approval_request_id:'request1'})}));});
 it('keeps failed request submission visible instead of claiming it was sent',async()=>{m.request.mockRejectedValue(new Error('Mất kết nối'));mount();reason();fireEvent.click(screen.getByRole('button',{name:'Gửi yêu cầu duyệt'}));expect(await screen.findByRole('alert')).toHaveTextContent('Mất kết nối');expect(screen.queryByRole('status')).not.toBeInTheDocument();expect(screen.getByRole('textbox',{name:'Chữ số OTP 1'})).toBeDisabled();});
 it('does not consume another OTP after a business failure when retrying the same authorized intent',async()=>{const run=vi.fn().mockRejectedValueOnce(new Error('Ca đã đóng')).mockResolvedValue(undefined);const{close}=mount(run);await send();paste();fireEvent.click(screen.getByRole('button',{name:'Xác nhận'}));expect(await screen.findByRole('alert')).toHaveTextContent('Ca đã đóng');expect(close).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xác nhận'}));await waitFor(()=>expect(close).toHaveBeenCalledWith(false));expect(m.verify).toHaveBeenCalledOnce();expect(run).toHaveBeenCalledTimes(2);});
 it('freezes the submitted reason so the approved intent cannot change silently',async()=>{mount();await send();expect(screen.getByPlaceholderText('VD: Khách đổi ý, đặt nhầm món, khách bỏ về...')).toBeDisabled();});
});
