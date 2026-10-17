import React from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { WorkingLibrary } from '@/components/operations/working-library';
import type { Workspace } from '@/lib/operations/contracts';
import { ceoWorkingRows } from '@/lib/operations/workbook-import';
vi.mock('@/components/ui/icon',()=>({Icon:()=>null}));
const fetchMock=vi.fn();
const branch='11111111-1111-4111-8111-111111111111';
const branch2='22222222-2222-4222-8222-222222222222';
const user='33333333-3333-4333-8333-333333333333';
const workspace={branches:[{id:branch,name:'Quán A',capabilities:['approve_policy']},{id:branch2,name:'Quán B',capabilities:['approve_policy']}],people:[{id:user,name:'Quản lý A'}]} as Workspace;
const lib={id:branch,title:'Bộ CEO',version:1,rows:ceoWorkingRows,notes:'',source_key:'ceo-working-20261014',archived:false,updated_at:'2026-10-17T00:00:00Z'};
let libraries:unknown[]=[];
beforeEach(()=>{libraries=[];vi.stubGlobal('fetch',fetchMock);fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>{
 if(url.startsWith('/api/operations/people'))return{ok:true,json:async()=>({people:[{id:user,name:'Quản lý A'}]})};
 if(init?.method==='POST')return{ok:true,json:async()=>({result:{}})};
 return{ok:true,json:async()=>({libraries,applications:[]})};
});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.resetAllMocks();});
describe('company working library and branch setup UX',()=>{
 it('loads definitions without any automatic save or branch assignment',async()=>{
  render(<WorkingLibrary workspace={workspace} onApplied={vi.fn()}/>);
  await screen.findByRole('button',{name:'Nạp 34 tiêu chí CEO'});
  expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
 });
 it('opens all 34 editable source rows and saves without requiring a manager or schedule',async()=>{
  render(<WorkingLibrary workspace={workspace} onApplied={vi.fn()}/>);
  const load=await screen.findByRole('button',{name:'Nạp 34 tiêu chí CEO'});await waitFor(()=>expect(load).toBeEnabled());fireEvent.click(load);
  expect(screen.getAllByRole('group',{name:/^Mục \d+$/})).toHaveLength(34);
  expect(within(screen.getByRole('group',{name:'Mục 19',exact:true})).getByLabelText('Công việc')).toHaveValue('Nguyên liệu');
  expect(within(screen.getByRole('group',{name:'Mục 20',exact:true})).getByLabelText('Công việc')).toHaveValue('Nguyên liệu');
  expect(screen.queryByRole('button',{name:/Quản lý phụ trách/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Lưu bộ tiêu chí chung',exact:true}));
  await waitFor(()=>expect(fetchMock.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true));
  const body=JSON.parse(fetchMock.mock.calls.find(([,init])=>init?.method==='POST')![1].body);
  expect(body.action).toBe('save');expect(body.rows).toHaveLength(34);expect(body).not.toHaveProperty('assignments');
 });
 it('supports adding, editing and removing a source criterion before saving',async()=>{
  render(<WorkingLibrary workspace={workspace} onApplied={vi.fn()}/>);
  const load=await screen.findByRole('button',{name:'Nạp 34 tiêu chí CEO'});await waitFor(()=>expect(load).toBeEnabled());fireEvent.click(load);
  fireEvent.click(screen.getByRole('button',{name:'Thêm tiêu chí',exact:true}));
  fireEvent.change(within(screen.getByRole('group',{name:'Mục 35',exact:true})).getByLabelText('Công việc'),{target:{value:'Việc do CEO thêm'}});
  expect(within(screen.getByRole('group',{name:'Mục 35',exact:true})).getByLabelText('Công việc')).toHaveValue('Việc do CEO thêm');
  fireEvent.click(screen.getByRole('button',{name:'Xóa tiêu chí 35: Việc do CEO thêm',exact:true}));
  expect(screen.getAllByRole('group',{name:/^Mục \d+$/})).toHaveLength(34);
 });
 it('reports the incomplete criterion even when it was hidden by a search',async()=>{
  render(<WorkingLibrary workspace={workspace} onApplied={vi.fn()}/>);
  const load=await screen.findByRole('button',{name:'Nạp 34 tiêu chí CEO'});await waitFor(()=>expect(load).toBeEnabled());fireEvent.click(load);
  fireEvent.click(screen.getByRole('button',{name:'Thêm tiêu chí',exact:true}));
  fireEvent.change(screen.getByLabelText('Tìm tiêu chí trong bộ chung'),{target:{value:'Nguyên liệu'}});
  fireEvent.click(screen.getByRole('button',{name:'Lưu bộ tiêu chí chung',exact:true}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Mục 35');
  expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
 });
 it('selects many branches and fills a shared schedule without choosing a manager',async()=>{
  libraries=[lib];render(<WorkingLibrary workspace={workspace} onApplied={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Áp dụng cho chi nhánh',exact:true}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Chọn tất cả chi nhánh chưa áp dụng trong phạm vi được phép'}));
  fireEvent.change(screen.getByLabelText('Ngày bắt đầu chung'),{target:{value:'2026-10-20'}});
  fireEvent.change(screen.getByLabelText('Giờ đến hạn chung'),{target:{value:'18:30'}});
  fireEvent.change(screen.getByLabelText('Ngày hằng tuần chung'),{target:{value:'6'}});
  fireEvent.click(screen.getByRole('button',{name:'Điền lịch cho 2 chi nhánh đã chọn'}));
  expect(screen.getAllByLabelText('Ngày bắt đầu').map(e=>(e as HTMLInputElement).value)).toEqual(['2026-10-20','2026-10-20']);
  expect(screen.getAllByLabelText('Giờ đến hạn').map(e=>(e as HTMLInputElement).value)).toEqual(['18:30','18:30']);
  expect(screen.getAllByLabelText('Ngày hằng tuần').map(e=>(e as HTMLSelectElement).value)).toEqual(['6','6']);
  expect(await screen.findAllByRole('button',{name:'Quản lý phụ trách * Chọn người'})).toHaveLength(2);
  expect(fetchMock.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
 });
});
