import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SearchableSelect } from '@/components/ui/searchable-select';
afterEach(cleanup);
const options = [
  {value:'all',label:'Tất cả khách'},
  {value:'nb',label:'Xưởng Tư Búa',meta:'KHA-NBO-001',searchText:'0901234567'},
  {value:'ws',label:'Khách Sỉ',meta:'KHA-WS-002'},
  {value:'disabled',label:'Xưởng Tư Búa cũ',disabled:true},
];
async function open(){fireEvent.click(screen.getByRole('button',{name:'Khách hàng'}));return screen.findByRole('combobox');}
describe('searchable entity picker',()=>{
 it('matches names without accents and light typos while retaining IDs',async()=>{
  const change=vi.fn();render(<SearchableSelect aria-label="Khách hàng" value="all" options={options} placeholder="Chọn khách" onValueChange={change}/>);
  const input=await open();fireEvent.change(input,{target:{value:'xuong tu bua'}});
  expect(screen.queryByRole('option',{name:/Khách Sỉ/})).toBeNull();
  fireEvent.change(input,{target:{value:'xuong tu bua'}});expect(change).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:'xuong tu bua'}});fireEvent.click(screen.getByRole('option',{name:/KHA-NBO-001/}));
  expect(change).toHaveBeenCalledWith('nb');
 });
 it('labels near matches and does not auto select with Enter or blur',async()=>{
  const change=vi.fn();render(<SearchableSelect aria-label="Khách hàng" options={options} placeholder="Chọn khách" onValueChange={change}/>);
  const input=await open();fireEvent.change(input,{target:{value:'xuong tu buaa'}});
  expect(screen.getAllByText('Gần đúng').length).toBeGreaterThan(0);
  fireEvent.keyDown(input,{key:'Enter'});fireEvent.blur(input);expect(change).not.toHaveBeenCalled();
 });
 it('searches literal phone/code and never corrects a wrong digit',async()=>{
  render(<SearchableSelect aria-label="Khách hàng" options={options} placeholder="Chọn khách" onValueChange={vi.fn()}/>);
  const input=await open();fireEvent.change(input,{target:{value:'0901234567'}});
  expect(screen.getAllByRole('option')).toHaveLength(1);
  fireEvent.change(input,{target:{value:'0901234568'}});expect(screen.queryAllByRole('option')).toHaveLength(0);
 });
 it('supports arrows, skips disabled choices and explicit Enter selection',async()=>{
  const change=vi.fn();render(<SearchableSelect aria-label="Khách hàng" options={options} placeholder="Chọn khách" preserveOrder onValueChange={change}/>);
  const input=await open();fireEvent.keyDown(input,{key:'ArrowUp'});fireEvent.keyDown(input,{key:'Enter'});
  expect(change).toHaveBeenCalledWith('ws');
 });
 it('Escape restores focus and preserves the selection; reopening clears query',async()=>{
  const change=vi.fn();render(<SearchableSelect aria-label="Khách hàng" value="all" options={options} placeholder="Chọn khách" onValueChange={change}/>);
  const input=await open();fireEvent.change(input,{target:{value:'not found'}});fireEvent.keyDown(input,{key:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('combobox')).toBeNull());expect(change).not.toHaveBeenCalled();
  expect((await open()) as HTMLInputElement).toHaveProperty('value','');
 });
 it('does not mutate a stale selection when options load or scope changes',async()=>{
  const change=vi.fn();const {rerender}=render(<SearchableSelect aria-label="Khách hàng" value="old" options={[]} placeholder="Chọn khách" onValueChange={change}/>);
  rerender(<SearchableSelect aria-label="Khách hàng" value="old" options={options} placeholder="Chọn khách" onValueChange={change}/>);
  expect(change).not.toHaveBeenCalled();expect(screen.getByText('Chọn khách')).toBeTruthy();
 });
});
