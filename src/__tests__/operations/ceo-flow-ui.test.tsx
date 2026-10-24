import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,cleanup,within} from '@testing-library/react';
import {QualityWorkspace} from '@/components/operations/quality-workspace';
import type {Workspace} from '@/lib/operations/contracts';
import type {QualityWorkspace as QualityData} from '@/lib/operations/quality-contracts';
import source from '@/lib/operations/ceo-workbook.json';
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
 it('places the work group before work and explains why an owner cannot record manager results',async()=>{
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,total:1,groups:[{id:'space',title:'Không gian và trải nghiệm'}],rows:[{id:'run',title:'Khu vực pha chế',code:'WS-0001',category:'group:space',frequency:'daily',manager_ids:[],quality:'unknown',state:'pending',original_due_at:'2026-10-22T16:59:00Z',criteria:[],checks:[]}]})});
  show();
  const heading=await screen.findByRole('columnheader',{name:'Nhóm công việc'});
  expect(heading.nextElementSibling).toHaveTextContent('Công việc');
  const table=screen.getByRole('table');
  const row=within(table).getByText('1. Khu vực pha chế').closest('tr')!;
  const cells=within(row).getAllByRole('cell');
  expect(cells[0]).toHaveTextContent('Không gian và trải nghiệm');
  expect(cells[1]).not.toHaveTextContent('Không gian và trải nghiệm');
  expect(cells[6]).toHaveTextContent('Chỉ xem');
  expect(screen.getAllByText('Nhóm công việc').length).toBeGreaterThan(1);
 });
 it('shows recording only for the assigned manager on desktop and mobile',async()=>{
  const row={id:'run',title:'Khu vực pha chế',frequency:'daily',manager_ids:['manager'],quality:'unknown',state:'pending',original_due_at:'2026-10-22T16:59:00Z',criteria:[],checks:[]};
  fetchMock.mockResolvedValue({ok:true,json:async()=>({...data,can:{...data.can,work:true},total:1,rows:[row]})});
  const view=show('work',{workspace:{...workspace,userId:'manager',isCeo:false}});
  await screen.findAllByRole('button',{name:'Ghi kết quả'});
  expect(screen.getAllByRole('button',{name:'Ghi kết quả'})).toHaveLength(2);
  view.unmount();
  show('work',{workspace:{...workspace,userId:'other-manager',isCeo:false}});
  expect((await screen.findAllByText('Không được phân công việc này')).length).toBe(2);
  expect(screen.queryByRole('button',{name:'Ghi kết quả'})).toBeNull();
 });
 it('removes only the repeated assignment list and keeps its branch-work navigation',async()=>{
  const assignment={family_id:'family-one',manager_ids:['manager']};
  fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url==='/api/operations/library'?{libraries:[],applications:[]}:{...data,assignments:[assignment]}}));
  const localWorkspace={...workspace,people:[{id:'manager',name:'Người phụ trách thử'}],standards:[{family_id:'family-one',title:'Thái độ'}]} as unknown as Workspace;
  show('settings',{workspace:localWorkspace,configuration:(_data,target)=><p>{target==='members'?'Người tại chi nhánh':'Danh sách công việc có phân công'}</p>});
  const nav=await screen.findByRole('navigation',{name:'Các bước thiết lập Hub'});
  fireEvent.click(within(nav).getByRole('button',{name:'3. Người và quyền'}));
  expect(screen.getByText('Đã phân công quản lý cho 1 công việc.')).toBeInTheDocument();
  expect(screen.queryByText(/Thái độ:.*Người phụ trách thử/)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Xem công việc chi nhánh'}));
  expect(screen.getByText('Danh sách công việc có phân công')).toBeInTheDocument();
  expect(assignment.manager_ids).toEqual(['manager']);
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
 it('shows all 34 QC criteria in Excel order with the original groups and requirements',async()=>{
  const catalog=source.rows.map(row=>({id:`c${row.number}`,family_id:`f${row.number}`,standard_id:`s${row.number}`,code:`WS-00000000000000000000000000000000-${String(row.number).padStart(4,'0')}`,title:row.title,group_title:row.group,category:'group:source',score_type:row.points>0?'bonus':'deduct',weight:Math.abs(row.points),criteria:[{id:`requirement${row.number}`,title:row.requirement}],effective_from:'2026-10-20',version:1})).reverse();
  fetchMock.mockImplementation(async(url:string)=>({ok:true,json:async()=>url==='/api/operations/library'?{libraries:[],applications:[]}:{...data,catalog}}));
  show('settings');
  const nav=await screen.findByRole('navigation',{name:'Các bước thiết lập Hub'});
  fireEvent.click(within(nav).getByRole('button',{name:'4. Tiêu chí QC'}));
  const table=screen.getByRole('table');
  const rows=within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(34);
  source.rows.forEach((item,index)=>{
   const cells=within(rows[index]).getAllByRole('cell');
   expect(cells[0]).toHaveTextContent(`${item.number}. ${item.title}`);
   expect(cells[0]).toHaveTextContent(item.requirement);
   expect(cells[1]).toHaveTextContent(item.group);
  });
  expect(catalog[0].code).toMatch(/0034$/);
  expect(screen.queryByRole('button',{name:'Tạo đợt QC'})).toBeNull();
  expect(fetchMock.mock.calls.every(([,init])=>!init?.method)).toBe(true);
 });
});
