import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({source:vi.fn(),preview:vi.fn(),apply:vi.fn(),toast:vi.fn(),branch:'branch'}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({activeBranchId:m.branch}),useToast:()=>({toast:m.toast})}));
vi.mock('@/lib/services/supabase/inventory-check-change',()=>({getInventoryCheckChangeSource:m.source,previewInventoryCheckChange:m.preview,applyInventoryCheckChange:m.apply}));
import {ChangeInventoryCheckDialog} from '@/components/shared/dialogs/change-inventory-check-dialog';
const target={id:'check',branchId:'branch',action:'edit' as const};
const plan={checkId:'check',code:'KK1',token:'preview-token',canApply:true,costVisible:true,costDelta:-200,
 items:[{productId:'milk',name:'Sữa',unit:'Hộp',stockBefore:15,stockAfter:13,stockDelta:-2,blocked:null}]};
beforeEach(()=>{vi.clearAllMocks();m.branch='branch';m.source.mockResolvedValue({id:'check',branchId:'branch',code:'KK1',status:'balanced',note:'Ghi chú cũ',version:'v1',items:[{productId:'milk',name:'Sữa',code:'SKU-SUA',unit:'Hộp',systemStock:10,actualStock:20}]});m.preview.mockResolvedValue(plan);m.apply.mockResolvedValue({...plan,applied:true});});
afterEach(cleanup);
async function setup(){render(<ChangeInventoryCheckDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()}/>);await screen.findByLabelText('Thực đếm sửa lại Sữa');fireEvent.change(screen.getByPlaceholderText('Nhập lý do, tối thiểu 3 ký tự'),{target:{value:'Đếm nhầm'}});fireEvent.change(screen.getByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'18'}});}
describe('inventory correction workflow',()=>{
 it('requires preview then explicit confirmation, invalidates preview when editing',async()=>{
  await setup();expect(m.apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));
  await screen.findByRole('region',{name:'Xem trước thay đổi kho'});expect(m.preview).toHaveBeenCalledWith(expect.objectContaining({sourceVersion:'v1',reason:'Đếm nhầm',items:[{productId:'milk',actualStock:18}]}));
  fireEvent.change(screen.getByLabelText('Thực đếm sửa lại Sữa'),{target:{value:'17'}});
  expect(screen.queryByRole('button',{name:'Lưu điều chỉnh'})).not.toBeInTheDocument();expect(m.apply).not.toHaveBeenCalled();
 });
 it('coalesces confirmation clicks and retries the same request after an uncertain reply',async()=>{
  await setup();fireEvent.click(screen.getByRole('button',{name:'Xem trước chênh lệch'}));const confirm=await screen.findByRole('button',{name:'Lưu điều chỉnh'});
  let fail!:(e:Error)=>void;m.apply.mockReturnValueOnce(new Promise((_,reject)=>{fail=reject;}));
  act(()=>{fireEvent.click(confirm);fireEvent.click(confirm);});await waitFor(()=>expect(m.apply).toHaveBeenCalledTimes(1));
  await act(async()=>fail(new Error('Mất kết nối')));await screen.findByText('Mất kết nối');
  fireEvent.click(screen.getByRole('button',{name:'Lưu điều chỉnh'}));await waitFor(()=>expect(m.apply).toHaveBeenCalledTimes(2));
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
});
