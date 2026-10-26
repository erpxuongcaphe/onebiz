import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LibraryAssignments } from '@/components/operations/library-assignments';
import type { Workspace } from '@/lib/operations/contracts';
import type { WorkingLibrary } from '@/lib/operations/working-library';
vi.mock('@/components/ui/icon',()=>({Icon:()=>null}));
const id='11111111-1111-4111-8111-111111111111';
const rows=[{familyId:'a',number:1,title:'Pha chế',group:'Không gian',before:['tien'],after:['tien'],changed:false,editable:true},{familyId:'b',number:2,title:'Phục vụ',group:'Dịch vụ',before:['thu'],after:['thu'],changed:false,editable:true}];
const current={libraryId:id,branchId:id,rows,people:[{id:'tien',name:'Tiên'},{id:'thu',name:'Thư'}],changed:0,token:'a'.repeat(32)};
const fetchMock=vi.fn();
beforeEach(()=>{
 vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
 vi.stubGlobal('fetch',fetchMock);
 fetchMock.mockImplementation(async(url:string,init?:RequestInit)=>{
  if(url.includes('/people'))return {ok:true,json:async()=>({people:[{id:'test',name:'Quản Lý Test'}]})};
  const command=JSON.parse(String(init?.body));
  const result=command.action==='preview'?{...current,changed:command.familyIds.length,rows:rows.map(r=>command.familyIds.includes(r.familyId)?{...r,after:[...r.before,'test'],changed:true}:r)}:current;
  return {ok:true,json:async()=>({result})};
 });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.resetAllMocks();});
function show(){const onSaved=vi.fn(),onClose=vi.fn();render(<LibraryAssignments library={{id,title:'Bộ tiêu chí CEO'} as WorkingLibrary} branchId={id} workspace={{branches:[{id,name:'Premium'}],people:current.people} as Workspace} onClose={onClose} onSaved={onSaved}/>);return {onSaved,onClose};}
async function chooseTest(){fireEvent.click(await screen.findByRole('button',{name:'Người được chọn * Chọn người'}));fireEvent.click(await screen.findByRole('button',{name:/^Quản Lý Test$/}));}
describe('edit already-applied branch assignments',()=>{
 it('loads current people and adds Test to all rows only after preview and confirmation',async()=>{
  const {onSaved}=show();await screen.findByText('Đang phụ trách: Tiên');await chooseTest();
  fireEvent.click(screen.getByRole('button',{name:'Xem trước thay đổi'}));
  await screen.findByRole('region',{name:'Xem trước phân công'});
  expect(fetchMock.mock.calls.some(([,init])=>JSON.parse(String(init?.body??'{}')).action==='update')).toBe(false);
  expect(screen.getAllByText('Tiên, Quản Lý Test').length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Lý do thay đổi'),{target:{value:'Thêm tài khoản quản lý test'}});
  fireEvent.click(screen.getByRole('button',{name:'Xác nhận lưu phân công'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
  const update=fetchMock.mock.calls.map(([,init])=>JSON.parse(String(init?.body??'{}'))).find(b=>b.action==='update');
  expect(update).toMatchObject({mode:'add',familyIds:['a','b'],managerIds:['test']});
 });
 it('selected criteria remain selected across searching without adding hidden rows',async()=>{
  show();await screen.findByText('Đang phụ trách: Tiên');
  fireEvent.change(screen.getByLabelText('2. Phạm vi tiêu chí'),{target:{value:'selected'}});
  fireEvent.click(screen.getByLabelText('Chọn 1. Pha chế'));
  fireEvent.change(screen.getByLabelText('Tìm tiêu chí'),{target:{value:'Phục vụ'}});
  await chooseTest();fireEvent.click(screen.getByRole('button',{name:'Xem trước thay đổi'}));
  await screen.findByRole('region',{name:'Xem trước phân công'});
  const body=fetchMock.mock.calls.map(([,init])=>JSON.parse(String(init?.body??'{}'))).find(b=>b.action==='preview');
  expect(body.familyIds).toEqual(['a']);
 });
 it('removal offers current assignees rather than only currently eligible managers',async()=>{
  show();await screen.findByText('Đang phụ trách: Tiên');
  fireEvent.change(screen.getByLabelText('Thao tác'),{target:{value:'remove'}});
  fireEvent.click(screen.getByRole('button',{name:'Người cần bớt * Chọn người'}));
  expect(await screen.findByRole('button',{name:/^Tiên$/})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/^Quản Lý Test$/})).toBeNull();
 });
 it('a failed preview never enables saving and preserves the choices',async()=>{
  show();await chooseTest();fetchMock.mockResolvedValueOnce({ok:false,json:async()=>({error:'Có công việc sẽ không còn người phụ trách.'})});
  fireEvent.click(screen.getByRole('button',{name:'Xem trước thay đổi'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('không còn người');
  expect(screen.queryByRole('button',{name:'Xác nhận lưu phân công'})).toBeNull();
  expect(screen.getByRole('button',{name:'Bỏ Quản Lý Test'})).toBeInTheDocument();
 });
});
