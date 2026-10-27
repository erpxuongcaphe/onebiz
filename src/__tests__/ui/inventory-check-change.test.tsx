import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({source:vi.fn(),preview:vi.fn(),apply:vi.fn(),toast:vi.fn(),branch:'branch',Failure:class extends Error {constructor(message:string,readonly code?:string,readonly outcomeUnknown=false){super(message);}}}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:m.branch}),useToast:()=>({toast:m.toast})}));
vi.mock('@/lib/services/supabase/inventory-check-change',()=>({getInventoryCheckChangeSource:m.source,previewInventoryCheckChange:m.preview,applyInventoryCheckChange:m.apply,InventoryCheckChangeError:m.Failure}));
import {ChangeInventoryCheckDialog} from '@/components/shared/dialogs/change-inventory-check-dialog';
const target={id:'check',branchId:'branch',action:'edit' as const};
const plan={checkId:'check',code:'KK1',token:'preview-token',canApply:true,costVisible:true,costDelta:-200,
 items:[{productId:'milk',name:'Sữa',code:'SKU-SUA',unit:'Hộp',actualBefore:20,actualAfter:18,stockBefore:15,stockAfter:13,stockDelta:-2,blocked:null}]};
beforeEach(()=>{vi.clearAllMocks();m.branch='branch';m.source.mockResolvedValue({id:'check',branchId:'branch',code:'KK1',status:'balanced',note:'Ghi chú cũ',version:'v1',items:[{productId:'milk',name:'Sữa',code:'SKU-SUA',unit:'Hộp',systemStock:10,actualStock:20}]});m.preview.mockResolvedValue(plan);m.apply.mockResolvedValue({...plan,applied:true});});
afterEach(cleanup);
async function setup(){render(<ChangeInventoryCheckDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()}/>);await screen.findByLabelText('Thực đếm sửa lại Sữa');fireEvent.change(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự'),{target:{value:'Đếm nhầm'}});fireEvent.change(screen.getByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'18'}});}
describe('inventory correction workflow',()=>{
 it('requires preview then explicit confirmation, invalidates preview when editing',async()=>{
  await setup();expect(m.apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));
  await screen.findByRole('region',{name:'Xem trước thay đổi kho'});expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({sourceVersion:'v1',reason:'Đếm nhầm',items:[{productId:'milk',actualStock:18}]}));
  expect(screen.getByRole('heading',{name:'Kiểm tra trước khi lưu điều chỉnh'})).toHaveFocus();
  expect(screen.queryByLabelText('Thực đếm sửa lại Sữa')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Sửa lại'}));
  expect(screen.getByLabelText('Thực đếm sửa lại Sữa')).toHaveValue('18');
  fireEvent.change(screen.getByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'17'}});
  expect(screen.queryByRole('button',{name:'Lưu điều chỉnh'})).not.toBeInTheDocument();expect(m.apply).not.toHaveBeenCalled();
 });
 it('coalesces confirmation clicks and retries the same request after an uncertain reply',async()=>{
  await setup();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));const confirm=await screen.findByRole('button',{name:'Lưu điều chỉnh'});
  let fail!:(e:Error)=>void;m.apply.mockReturnValueOnce(new Promise((_,reject)=>{fail=reject;}));
  act(()=>{fireEvent.click(confirm);fireEvent.click(confirm);});await waitFor(()=>expect(m.apply).toHaveBeenCalledTimes(1));
  await act(async()=>fail(new Error('Mất kết nối')));await screen.findByText('Mất kết nối');
  expect(screen.queryByRole('button',{name:'Sửa lại'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Kiểm tra lại kết quả'}));await waitFor(()=>expect(m.apply).toHaveBeenCalledTimes(2));
  expect(m.apply.mock.calls[1]).toEqual(m.apply.mock.calls[0]);
 });
 it('blocks confirmation when preview finds insufficient current stock',async()=>{
  m.preview.mockResolvedValue({...plan,canApply:false,items:[{...plan.items[0],blocked:'INSUFFICIENT_CURRENT_STOCK'}]});
  await setup();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));
  expect(await screen.findByRole('button',{name:'Lưu điều chỉnh'})).toBeDisabled();expect(screen.getByText(/Không đủ tồn hiện tại/)).toBeInTheDocument();expect(m.apply).not.toHaveBeenCalled();
 });
 it('refuses a branch switch and never posts into the newly selected branch',async()=>{
  m.branch='other';await setup();expect(screen.getByRole('button',{name:'Xem trước chênh lệch'})).toBeDisabled();expect(m.preview).not.toHaveBeenCalled();expect(m.apply).not.toHaveBeenCalled();
 });
 it('requires an actual edit, not just a reason, before offering preview',async()=>{
  render(<ChangeInventoryCheckDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()}/>);
  await screen.findByLabelText('Thực đếm sửa lại Sữa');
  fireEvent.change(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự'),{target:{value:'Chỉ xem phiếu'}});
  expect(screen.getByRole('button',{name:'Xem trước chênh lệch'})).toBeDisabled();expect(m.preview).not.toHaveBeenCalled();
 });
 it('removes stale confirmation while keeping the entered counts and reason',async()=>{
  m.apply.mockRejectedValue(new m.Failure('Tồn kho vừa thay đổi','40001'));
  await setup();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));
  fireEvent.click(await screen.findByRole('button',{name:'Lưu điều chỉnh'}));await screen.findByText('Tồn kho vừa thay đổi');
  expect(screen.queryByRole('button',{name:'Lưu điều chỉnh'})).not.toBeInTheDocument();
  expect(screen.getByLabelText('Thực đếm sửa lại Sữa')).toHaveValue('18');expect(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự')).toHaveValue('Đếm nhầm');
 });
 it('protects entered values when closing from the preview step',async()=>{
  const close=vi.fn();render(<ChangeInventoryCheckDialog target={target} onClose={close} onSuccess={vi.fn()}/>);
  fireEvent.change(await screen.findByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'18'}});
  fireEvent.change(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự'),{target:{value:'Đếm nhầm'}});
  fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));await screen.findByRole('region',{name:'Xem trước thay đổi kho'});
  fireEvent.click(screen.getAllByRole('button',{name:'Đóng'})[0]);
  await screen.findByText('Có nội dung chưa lưu');expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Tiếp tục chỉnh sửa'}));
  expect(screen.getByRole('button',{name:'Lưu điều chỉnh'})).toBeInTheDocument();expect(m.apply).not.toHaveBeenCalled();
 });
 it('shows corrected draft quantities even though the draft does not change stock',async()=>{
  m.preview.mockResolvedValue({...plan,items:[{...plan.items[0],stockDelta:0,stockAfter:15}]});
  await setup();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));
  await screen.findByRole('region',{name:'Xem trước thay đổi kho'});expect(screen.getByText(/Thực đếm:/)).toHaveTextContent('20 → 18');
 });
 it('does not report a committed save as failed when the list refresh fails',async()=>{
  const close=vi.fn();render(<ChangeInventoryCheckDialog target={target} onClose={close} onSuccess={async()=>{throw new Error('List unavailable');}}/>);
  fireEvent.change(await screen.findByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'18'}});
  fireEvent.change(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự'),{target:{value:'Đếm nhầm'}});
  fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));fireEvent.click(await screen.findByRole('button',{name:'Lưu điều chỉnh'}));
  await waitFor(()=>expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({title:'Đã lưu phiếu; danh sách chưa tải lại được',variant:'info'})));
  expect(close).toHaveBeenCalledOnce();expect(m.apply).toHaveBeenCalledOnce();
 });
});
