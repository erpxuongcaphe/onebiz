import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
const mocks=vi.hoisted(()=>({get:vi.fn(),source:vi.fn(),submit:vi.fn(),branch:'outlet',params:'sale=sale'}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(mocks.params)}));
vi.mock('@/lib/contexts',()=>({useAuth:()=>({user:{id:'actor'}}),useBranchFilter:()=>({isReady:true,activeBranchId:mocks.branch,branches:[{id:'outlet',name:'Quán'},{id:'warehouse',name:'Kho Tổng'}]})}));
vi.mock('@/lib/permissions/use-permission',()=>({usePermissions:()=>({hasPermission:()=>true})}));
vi.mock('@/lib/services/supabase/internal-returns',()=>({getInternalReturns:mocks.get,submitInternalReturn:mocks.submit}));
vi.mock('@/lib/services/supabase/internal-receiving',()=>({getInternalReceivingWorkspace:mocks.source}));
import Page from '@/app/(main)/hang-hoa/nhap-hang/tra-noi-bo/page';
beforeEach(()=>{
 vi.clearAllMocks();sessionStorage.clear();mocks.branch='outlet';mocks.params='sale=sale';mocks.get.mockResolvedValue([]);
 mocks.source.mockResolvedValue([{id:'sale',code:'NB001',status:'completed',items:[
  {id:'line',name:'Trà Ô Long',code:'SKU-001',unit:'Túi',received:5,receivingFactor:500,receivingUnit:'G',treatment:'stock'},
  {id:'other',name:'Đường',code:'SKU-002',unit:'Kg',received:4,treatment:'stock'},
  {id:'expense',name:'Vật tư',code:'SKU-003',unit:'Cái',received:3,treatment:'expense'},
 ]}]);
 mocks.submit.mockResolvedValue({id:'return'});
});
describe('internal returns confirmation',()=>{
 it('restores an uncertain request after reload without creating another return',async()=>{
  const pending={key:'same-request',action:'send',id:'sale',items:[{itemId:'line',quantity:2}],note:'Hàng dư chưa dùng'};
  sessionStorage.setItem('onebiz:internal-return:actor:outlet',JSON.stringify(pending));
  render(<Page/>);
  fireEvent.click(await screen.findByRole('button',{name:'Thử lại cùng yêu cầu'}));
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledWith('send','sale',pending.items,pending.note,'same-request'));
  await waitFor(()=>expect(sessionStorage.getItem('onebiz:internal-return:actor:outlet')).toBeNull());
 });
 it('requires a preview and shows converted stock before sending; retries reuse the request',async()=>{
  render(<Page/>);
  const tea=await screen.findByRole('checkbox',{name:'Chọn trả Trà Ô Long'});
  expect(screen.queryByLabelText('Số gửi trả Trà Ô Long')).not.toBeInTheDocument();
  expect(screen.queryByRole('checkbox',{name:'Chọn trả Vật tư'})).not.toBeInTheDocument();
  fireEvent.click(tea);
  const qty=await screen.findByLabelText('Số gửi trả Trà Ô Long');
  fireEvent.change(qty,{target:{value:'2'}});fireEvent.blur(qty);
  fireEvent.change(screen.getByRole('textbox',{name:'Lý do trả *'}),{target:{value:'Hàng dư chưa dùng'}});
  const sugar=screen.getByRole('checkbox',{name:'Chọn trả Đường'});
  fireEvent.click(sugar);
  expect(screen.getByRole('button',{name:'Xem trước'})).toBeDisabled();
  fireEvent.click(sugar);
  expect(screen.queryByLabelText('Số gửi trả Đường')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Xem trước'}));
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(screen.getByText(/giảm tồn chi nhánh 1,000 G/)).toBeVisible();
  mocks.submit.mockRejectedValueOnce(new Error('Mất kết nối'));
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận gửi trả'}));
  const retry=await screen.findByRole('button',{name:'Thử lại cùng yêu cầu'});
  expect(qty).toBeDisabled();fireEvent.click(retry);
  await waitFor(()=>expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit.mock.calls[0][2]).toEqual([{itemId:'line',quantity:2}]);
  expect(mocks.submit.mock.calls[0]).toEqual(mocks.submit.mock.calls[1]);
 });
 it('clears source rows while another branch is loading',async()=>{
  render(<Page/>);fireEvent.click(await screen.findByRole('checkbox',{name:'Chọn trả Trà Ô Long'}));
  mocks.get.mockReturnValue(new Promise(()=>{}));
  fireEvent.change(screen.getByLabelText('Chi nhánh'),{target:{value:'warehouse'}});
  await waitFor(()=>expect(screen.queryByLabelText('Số gửi trả Trà Ô Long')).not.toBeInTheDocument());
  expect(screen.queryByRole('button',{name:'Xem trước'})).not.toBeInTheDocument();
 });
 it('uses the active branch when the link points outside available branches',async()=>{
  mocks.branch='warehouse';
  mocks.params='branch=unavailable&sale=sale';
  render(<Page/>);
  await waitFor(()=>expect(mocks.get).toHaveBeenCalledWith('warehouse',undefined));
  expect(screen.getByLabelText('Chi nhánh')).toHaveValue('warehouse');
  expect(mocks.source).not.toHaveBeenCalled();
 });
});
