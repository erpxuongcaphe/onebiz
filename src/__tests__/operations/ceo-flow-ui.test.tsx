import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {QualityWorkspace} from '@/components/operations/quality-workspace';
import type {Workspace} from '@/lib/operations/contracts';
import type {QualityWorkspace as QualityData} from '@/lib/operations/quality-contracts';
vi.mock('@/components/ui/icon',()=>({Icon:()=>null}));
const branch='11111111-1111-4111-8111-111111111111';
const workspace={userId:'owner',isCeo:true,branches:[{id:branch,name:'Quán thử',capabilities:['approve_policy']}],people:[],members:[],standards:[],runs:[],todos:[]} as unknown as Workspace;
const data={can:{manage:true,work:false,qc:false,correct:false,accounting:false,close:true},rows:[],total:0,offset:0,limit:50,groups:[],catalog:[],rules:[],assignments:[],grants:[],departments:[],periods:[],score:{official:false,score:null,completedAudits:0},accounting:[]} as unknown as QualityData;
const fetchMock=vi.fn();
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-22T03:00:00Z'));vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.stubGlobal('fetch',fetchMock);fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url==='/api/operations/library'?{libraries:[],applications:[]}:data}));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();vi.resetAllMocks();});
function show(view:'work'|'settings'|'issues'|'qc'='work',options:Partial<React.ComponentProps<typeof QualityWorkspace>>={}){
 return render(<QualityWorkspace workspace={workspace} branch={branch} period="2026-10" initialView={view} onLegacySettings={vi.fn()} onAssessmentPeriodChange={vi.fn()} {...options}/>);
}
describe('CEO and manager Hub journey',()=>{
 it('opens today rather than dumping the month and distinguishes permission from a missing button',async()=>{
  show();
  expect(await screen.findByText(/Bạn đang xem kết quả của chi nhánh/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Hôm nay'})).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByLabelText('Kỳ đánh giá QC và thưởng')).toBeNull();
  const url=new URL(fetchMock.mock.calls[0][0],'http://local');
  expect(url.searchParams.get('from')).toBeTruthy();expect(url.searchParams.get('to')).toBeTruthy();
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('preserves explicit period-focused navigation from the overview',async()=>{
  show('work',{focus:{periodOnly:true}});
  await screen.findByRole('button',{name:'Trong kỳ'});
  expect(screen.getByRole('button',{name:'Trong kỳ'})).toHaveAttribute('aria-pressed','true');
 });
 it('keeps To-do branch-wide and all-time by default',async()=>{
  show('issues');await screen.findByText(/Bạn đang xem To-do/);
  expect(screen.getByLabelText('Khoảng thời gian')).toHaveValue('all');
  expect(screen.getByLabelText('Liên quan đến tôi')).not.toBeChecked();
 });
 it('uses the selected historical month instead of today',async()=>{
  show('work',{period:'2026-09'});
  await screen.findByRole('button',{name:'Trong kỳ'});
  expect(screen.getByRole('button',{name:'Trong kỳ'})).toHaveAttribute('aria-pressed','true');
  const url=new URL(fetchMock.mock.calls[0][0],'http://local');
  expect(url.searchParams.get('from')).toBe('2026-08-31T17:00:00.000Z');
 });
 it('shows source numbers and requirements without giving an owner manager-write access',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,total:1,rows:[{id:'run',title:'Nguyên liệu',code:'WS-00000000000000000000000000000000-0019',frequency:'daily',manager_ids:[],quality:'unknown',state:'pending',original_due_at:'2026-10-22T16:59:00Z',criteria:[{id:'criterion',title:'Bao bì chưa mở không bị rách'}],checks:[]}]})});
  show();await screen.findAllByText('19. Nguyên liệu');
  expect(screen.queryByRole('button',{name:'Ghi kết quả'})).toBeNull();
  fireEvent.click(screen.getAllByText('Yêu cầu cần đạt')[0]);
  expect(screen.getAllByText('Bao bì chưa mở không bị rách').length).toBeGreaterThan(0);
  expect(screen.getByText('1 lượt thực hiện · trang 1')).toBeInTheDocument();
 });
 it('organizes setup into one visible destination at a time',async()=>{
  show('settings',{configuration:(_data,target)=><p>{target==='members'?'Danh sách phân công thử':'Công việc chi nhánh thử'}</p>});
  const nav=await screen.findByRole('navigation',{name:'Các bước thiết lập Hub'});
  expect(within(nav).getByRole('button',{name:'1. Bộ tiêu chí chung'})).toHaveAttribute('aria-current','step');
  fireEvent.click(within(nav).getByRole('button',{name:'2. Công việc chi nhánh'}));
  expect(screen.getByText('Công việc chi nhánh thử')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Thêm nhóm QC'})).toBeNull();
  fireEvent.click(within(nav).getByRole('button',{name:'3. Người và quyền'}));
  expect(screen.getByText('Danh sách phân công thử')).toBeInTheDocument();
  expect(screen.queryByText('Công việc chi nhánh thử')).toBeNull();
  fireEvent.click(within(nav).getByRole('button',{name:'5. Điểm và thưởng'}));
  expect(await screen.findByRole('button',{name:'Chính sách mới'})).toBeInTheDocument();
  await waitFor(()=>expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true));
 });
});
