import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserPicker } from "@/components/operations/user-picker";
vi.mock("@/components/ui/icon",()=>({Icon:()=>null}));
const fetchMock=vi.fn();
beforeEach(()=>vi.stubGlobal('fetch',fetchMock));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.resetAllMocks();});
const person={id:'11111111-1111-4111-8111-111111111111',name:'Nguyễn Quản Lý'};
const another={id:'22222222-2222-4222-8222-222222222222',name:'Trần Phối Hợp'};
describe('scoped chip-style user picker',()=>{
 it('never selects the first available user automatically',()=>{
  const {container}=render(<form><UserPicker label="Phụ trách" name="assigneeId" required options={[person]}/></form>);
  expect(new FormData(container.querySelector('form')!).get('assigneeId')).toBe('');
  expect(container.querySelector('select')!.validity.valueMissing).toBe(true);
 });
 it('searches, adds a named chip and supports removing it',()=>{
  const {container}=render(<form><UserPicker label="Phụ trách" name="assigneeId" required options={[person,another]}/></form>);
  fireEvent.click(screen.getByRole('button',{name:'Phụ trách * Chọn người'}));
  fireEvent.change(screen.getByRole('textbox',{name:'Tìm phụ trách'}),{target:{value:'Nguyễn'}});
  expect(screen.queryByRole('button',{name:another.name})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:person.name}));
  expect(new FormData(container.querySelector('form')!).get('assigneeId')).toBe(person.id);
  fireEvent.click(screen.getByRole('button',{name:`Bỏ ${person.name}`}));
  expect(new FormData(container.querySelector('form')!).get('assigneeId')).toBe('');
 });
 it('adds multiple users without Ctrl and serializes all selected IDs',()=>{
  const {container}=render(<form><UserPicker label="Phối hợp" name="collaborators" multiple options={[person,another]}/></form>);
  fireEvent.click(screen.getByRole('button',{name:'Phối hợp Chọn người'}));
  fireEvent.click(screen.getByRole('button',{name:person.name}));
  fireEvent.click(screen.getByRole('button',{name:another.name}));
  expect(new FormData(container.querySelector('form')!).getAll('collaborators')).toEqual([person.id,another.id]);
  expect(screen.getByRole('button',{name:person.name})).toHaveAttribute('aria-pressed','true');
  fireEvent.click(screen.getByRole('button',{name:person.name}));
  expect(new FormData(container.querySelector('form')!).getAll('collaborators')).toEqual([another.id]);
  fireEvent.click(screen.getByRole('button',{name:`Bỏ ${another.name}`}));
  expect(new FormData(container.querySelector('form')!).getAll('collaborators')).toEqual([]);
 });
 it('clears submitted IDs and blocks save after switching to an ineligible branch',async()=>{
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({people:[person]})});
  const {container,rerender}=render(<UserPicker label="Phụ trách" name="assigneeId" branch="branch-a" value={person.id} required/>);
  await waitFor(()=>expect(container.querySelector('select')!.value).toBe(person.id));
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({people:[another]})});
  rerender(<UserPicker label="Phụ trách" name="assigneeId" branch="branch-b" value={person.id} required/>);
  await screen.findByRole('alert');
  expect(container.querySelector('select')!.value).toBe('');
  expect(container.querySelector('select')!.validity.valueMissing).toBe(true);
 });
 it('does not retry automatically or use a general directory on network failure',async()=>{
  fetchMock.mockRejectedValueOnce(new Error('Không tải được danh sách người.'));
  render(<UserPicker label="Phụ trách" branch="branch-a" required/>);
  await screen.findByRole('alert');expect(fetchMock).toHaveBeenCalledOnce();
  expect(screen.getByRole('button',{name:'Phụ trách * Chọn người'})).toBeDisabled();
 });
 it('keeps Escape inside the picker instead of closing the containing form',()=>{
  const parent=vi.fn();render(<div onKeyDown={parent}><UserPicker label="Phụ trách" options={[person]}/></div>);
  fireEvent.click(screen.getByRole('button',{name:'Phụ trách Chọn người'}));
  fireEvent.keyDown(screen.getByRole('textbox',{name:'Tìm phụ trách'}),{key:'Escape'});
  expect(parent).not.toHaveBeenCalled();expect(screen.queryByRole('textbox',{name:'Tìm phụ trách'})).toBeNull();
 });
});
