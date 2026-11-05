import React from 'react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,within,waitFor} from '@testing-library/react';
import {QualityWorkspace} from '@/components/operations/quality-workspace';
import OperationsWorkspace from '@/components/operations/workspace';
import {SetupNavigation} from '@/components/operations/setup-navigation';
import type {Workspace} from '@/lib/operations/contracts';
import type {QualityWorkspace as QualityData} from '@/lib/operations/quality-contracts';
vi.mock('@/components/ui/icon',()=>({Icon:()=>null}));
const branch='11111111-1111-4111-8111-111111111111',runId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspace={userId:'owner',isCeo:true,period:'2026-11',branches:[{id:branch,name:'Chi nhánh thử',capabilities:['view']}],people:[],members:[],standards:[],runs:[],todos:[],revenues:[],targets:[],policies:[],periods:[],audit:[]} as unknown as Workspace;
const score={official:false,score:null,rawScore:null,completedAudits:0,deductions:0,bonus:0,critical:false,rewardReady:false,rewardCents:null,reasons:['Chưa có đợt QC hoàn tất.']};
const data={can:{manage:true,work:false,qc:false,correct:false,accounting:false,close:true},rows:[],total:0,offset:0,limit:50,groups:[{id:'space',title:'Nhóm theo Excel',active:true,version:1}],catalog:[],rules:[],assignments:[],grants:[],departments:[],periods:[],score,accounting:[]} as unknown as QualityData;
const fetchMock=vi.fn();
beforeEach(()=>{
 window.history.replaceState(null,'','/hub');vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-11-04T03:00:00Z'));
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('fetch',fetchMock);fetchMock.mockImplementation(async(input:string)=>({ok:true,json:async()=>input.startsWith('/api/operations?')?workspace:input.includes('/library')?{libraries:[],applications:[]}:input.includes('/inbox')?{rows:[]}:data}));
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks();});
function show(view:'work'|'qc'|'report'|'issues'='work',extra:Partial<React.ComponentProps<typeof QualityWorkspace>>={}){return render(<QualityWorkspace workspace={workspace} branch={branch} period="2026-10" initialView={view} onLegacySettings={vi.fn()} {...extra}/>);}
describe('Hub UX source requirements',()=>{
 it.each([
  {view:'work',group:'Lọc nhanh kết quả',label:'Không đạt',param:'result',value:'unmet'},
  {view:'issues',group:'Lọc nhanh trạng thái',label:'Chờ nghiệm thu',param:'state',value:'pending_review'},
  {view:'qc',group:'Lọc nhanh trạng thái',label:'Đang chấm',param:'state',value:'draft'},
 ] as const)('applies $view quick filters through the authorized API',async({view,group,label,param,value})=>{
  show(view);
  const button=within(await screen.findByRole('group',{name:group})).getByRole('button',{name:label});
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-pressed','true');
  await waitFor(()=>expect(new URL(fetchMock.mock.calls.at(-1)![0],'http://test').searchParams.get(param)).toBe(value));
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('links QC and KPI without exposing any closing action to a viewer',async()=>{
  const onNavigate=vi.fn();
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,can:{...data.can,close:false}})});
  show('report',{onNavigate});
  const readiness=await screen.findByRole('region',{name:'Điều kiện chốt kỳ'});
  fireEvent.click(within(readiness).getByRole('button',{name:'Xem đợt QC'}));
  expect(onNavigate).toHaveBeenCalledWith('qc',{periodOnly:true});
  expect(screen.queryByRole('button',{name:'Chốt kỳ'})).toBeNull();
 });
 it('recovers a forbidden URL branch through the authorized workspace without granting access',async()=>{
  const forbidden='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  window.history.replaceState(null,'',`/hub?view=work&branch=${forbidden}&period=2026-11`);
  fetchMock.mockImplementation(async(input:string)=>input.includes(`branch=${forbidden}`)?{ok:false,status:403,json:async()=>({error:'Không có quyền'})}:{ok:true,json:async()=>input.startsWith('/api/operations?')?workspace:input.includes('/library')?{libraries:[],applications:[]}:input.includes('/inbox')?{rows:[]}:data});
  render(<OperationsWorkspace/>);await screen.findByText(/Chi nhánh trong đường dẫn không còn phù hợp/);
  await waitFor(()=>expect(new URLSearchParams(window.location.search).get('branch')).toBe(branch));
  expect(fetchMock.mock.calls.filter(([input])=>input.startsWith('/api/operations?')&&input.includes(`branch=${forbidden}`))).toHaveLength(1);
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('does not retry indefinitely when Hub access itself is forbidden',async()=>{
  window.history.replaceState(null,'',`/hub?view=work&branch=${branch}&period=2026-11`);
  fetchMock.mockResolvedValue({ok:false,status:403,json:async()=>({error:'Tài khoản chưa có quyền Hub'})});
  render(<OperationsWorkspace/>);await screen.findByText('Tài khoản chưa có quyền Hub');
  expect(fetchMock.mock.calls.filter(([input])=>input.startsWith('/api/operations?'))).toHaveLength(2);
 });
 it('P1-01 labels the actual date range when Today is outside the reference month',async()=>{
  show();await screen.findByRole('button',{name:'Hôm nay'});fireEvent.click(screen.getByRole('button',{name:'Hôm nay'}));
  expect(await screen.findByText(/Đang xem: 04\/11\/2026/)).toBeInTheDocument();
  expect(screen.getByText(/tháng ở đầu trang là kỳ tham chiếu/)).toBeInTheDocument();
  await waitFor(()=>expect(new URL(fetchMock.mock.calls.at(-1)![0],'http://test').searchParams.get('from')).toBe('2026-11-03T17:00:00.000Z'));
 });
 it('P1-03 leaves unconfirmed KPI values unknown and shows closing prerequisites',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,total:13})});
  show('report');await screen.findByText('Chưa xác định');
  expect(screen.getAllByText('Chưa có kết quả').length).toBeGreaterThan(0);
  expect(within(screen.getByRole('region',{name:'Điều kiện chốt kỳ'})).getByText('Chưa có đợt QC hoàn tất.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Chốt kỳ'})).toBeDisabled();
  expect(screen.getByRole('navigation',{name:'Nội dung KPI và thưởng'})).toBeInTheDocument();
  expect(screen.queryByText('13 hồ sơ · trang 1')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Sổ điểm QC'}));
  expect(screen.getByText('13 hồ sơ · trang 1')).toBeInTheDocument();
 });
 it('labels QC weight as a conditional rule rather than an actual deduction on a passed mobile line',async()=>{
  const auditId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  window.history.replaceState(null,'',`/hub?view=qc&audit=${auditId}`);
  const audit={id:auditId,title:'Đợt QC đã hoàn tất',period:'2026-10',state:'completed',auditor_id:'qc',created_at:'2026-10-01T03:00:00Z',completed_at:'2026-10-01T04:00:00Z',version:2,rule_id:null};
  fetchMock.mockImplementation(async(input:string)=>({ok:true,json:async()=>({...data,audit,rows:input.includes(`entity=${auditId}`)?[{id:'line',audit_id:auditId,item_snapshot:{title:'Khu vực pha chế',score_type:'deduct',weight:5,code:'QC-1'},result:'met',evidence:'Bằng chứng kiểm tra tại quán',note:'',corrections:[],version:1}]:[audit],total:1})}));
  show('qc');expect(await screen.findByText('Trọng số: trừ 5 điểm khi không đạt')).toBeInTheDocument();
  expect(screen.getByText('Minh chứng / ghi chú: Bằng chứng kiểm tra tại quán')).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('keeps settlement disabled until the Vietnam evaluation period has actually ended',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,score:{...score,official:true,rewardReady:true,reasons:[]}})});
  const first=show('report',{period:'2026-11'});await screen.findByText(/Kỳ kết thúc ngày 30\/11\/2026/);
  expect(screen.getByRole('button',{name:'Chốt kỳ'})).toBeDisabled();first.unmount();
  show('report',{period:'2026-10'});await waitFor(()=>expect(screen.getByRole('button',{name:'Chốt kỳ'})).toBeEnabled());
 });
 it('uses the custom evaluation end date instead of the reference calendar month for settlement',async()=>{
  const key='custom:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,periods:[{key,title:'Kỳ riêng',starts_on:'2026-10-25',ends_on:'2026-11-05',closed:false}],score:{...score,official:true,rewardReady:true,reasons:[]}})});
  show('report',{period:'2026-10',assessmentPeriod:key});await screen.findByText(/Kỳ kết thúc ngày 05\/11\/2026/);
  expect(screen.getByRole('button',{name:'Chốt kỳ'})).toBeDisabled();
 });
 it('keeps setup readiness consistent with the unfinished evaluation period',()=>{
  render(<SetupNavigation value="reward" onChange={vi.fn()} data={{...data,score:{...data.score,rewardReady:true}}} isCeo settlementPeriodEnded={false}/>);
  expect(screen.getByText('Đã đủ điểm/quỹ · chờ kết thúc kỳ')).toBeInTheDocument();
  expect(screen.queryByText('Đủ điều kiện để xem trước chốt kỳ')).toBeNull();
  expect(screen.getByText(/Chưa có chính sách thưởng không chặn công việc hằng ngày/)).toBeInTheDocument();
 });
 it('P1-04 restores QC from its URL after a remount instead of falling back to work',async()=>{
  window.history.replaceState(null,'',`/hub?view=qc&branch=${branch}&period=2026-10&f_state=completed`);
  const first=render(<OperationsWorkspace/>);await screen.findByRole('heading',{name:'QC độc lập',level:1});
  expect(await screen.findByRole('combobox',{name:'Trạng thái'})).toHaveValue('completed');first.unmount();
  render(<OperationsWorkspace/>);expect(await screen.findByRole('heading',{name:'QC độc lập',level:1})).toBeInTheDocument();
  expect(await screen.findByRole('combobox',{name:'Trạng thái'})).toHaveValue('completed');
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('P1-04 handles back/forward context without changing authorization',async()=>{
  window.history.replaceState(null,'',`/hub?view=qc&branch=${branch}&period=2026-10`);render(<OperationsWorkspace/>);
  await screen.findByRole('heading',{name:'QC độc lập',level:1});
  fireEvent.click(screen.getByRole('button',{name:'To-do'}));await screen.findByRole('heading',{name:'To-do',level:1});
  window.history.replaceState(null,'',`/hub?view=qc&branch=${branch}&period=2026-10`);fireEvent(window,new PopStateEvent('popstate'));
  expect(await screen.findByRole('heading',{name:'QC độc lập',level:1})).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Tạo đợt QC'})).toBeNull();
 });
 it('P2-03 distinguishes an empty scope from search misses and hides zero-result pagination',async()=>{
  show('issues');await screen.findByRole('region',{name:'Không có kết quả'});
  expect(screen.queryByRole('button',{name:'Sau'})).toBeNull();
  fireEvent.change(screen.getByRole('searchbox',{name:'Tìm công việc / vấn đề'}),{target:{value:'không trùng'}});
  expect(await screen.findByText('Không tìm thấy kết quả cho “không trùng”')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Xóa tìm kiếm'}));expect(screen.getByRole('searchbox',{name:'Tìm công việc / vấn đề'})).toHaveValue('');
 });
 it('keeps branch group choices while filters are loading, not To-do categories',async()=>{
  show();await screen.findByRole('option',{name:'Nhóm theo Excel'});
  fetchMock.mockReturnValue(new Promise(()=>{}));fireEvent.change(screen.getByRole('combobox',{name:'Khoảng thời gian'}),{target:{value:'today'}});
  expect(screen.getByRole('option',{name:'Nhóm theo Excel'})).toBeInTheDocument();expect(screen.queryByRole('option',{name:'Khác'})).toBeNull();
 });
 it('opens read-only task detail with standards and original deadline but no owner manager-write button',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,total:1,rows:[{id:runId,title:'Thử quy trình',frequency:'daily',manager_ids:[],quality:'unknown',state:'pending',original_due_at:'2026-11-04T16:59:00Z',criteria:[{id:'criterion',title:'Yêu cầu theo file'}],checks:[]}]})});
  show();fireEvent.click((await screen.findAllByRole('button',{name:'Xem chi tiết'}))[0]);
  const dialog=await screen.findByRole('dialog');expect(within(dialog).getByText('Yêu cầu theo file')).toBeInTheDocument();expect(within(dialog).queryByRole('button',{name:'Ghi kết quả'})).toBeNull();
  fireEvent.click(within(dialog).getByRole('button',{name:'Đóng chi tiết'}));expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('shows existing check notes and evidence without submitting a new result',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,total:1,rows:[{id:runId,title:'Việc đã kiểm tra',frequency:'daily',manager_ids:[],quality:'met',state:'completed',original_due_at:'2026-11-04T16:59:00Z',criteria:[{id:'criterion',title:'Yêu cầu theo file'}],checks:[{id:'check',result:'met',actor_id:'manager',created_at:'2026-11-04T09:00:00Z',note:'Đã đối chiếu tại quán',observations:[{criterionId:'criterion',slot:'1',value:1,evidence:'Ảnh đã kiểm tra'}]}]}]})});
  show();fireEvent.click((await screen.findAllByRole('button',{name:'Xem chi tiết'}))[0]);
  const dialog=await screen.findByRole('dialog');expect(within(dialog).getByText('Ghi chú: Đã đối chiếu tại quán')).toBeInTheDocument();expect(within(dialog).getByText(/Minh chứng: Ảnh đã kiểm tra/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
});
