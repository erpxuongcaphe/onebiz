import React from 'react';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {MonthScope} from '@/components/operations/month-scope';
afterEach(cleanup);
describe('Vietnamese Hub month scope',()=>{
 it('shows Vietnamese months and preserves the chosen year',()=>{
  const change=vi.fn();render(<MonthScope value="2026-10" onChange={change}/>);
  expect(screen.getByRole('option',{name:'Tháng 10',selected:true})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tháng xem dữ liệu'),{target:{value:'09'}});
  expect(change).toHaveBeenCalledWith('2026-09');
 });
 it('does not load malformed partial years and restores an incomplete entry on blur',()=>{
  const change=vi.fn();render(<MonthScope value="2026-10" onChange={change}/>);
  const year=screen.getByLabelText('Năm xem dữ liệu');fireEvent.change(year,{target:{value:'20'}});
  expect(change).not.toHaveBeenCalled();fireEvent.blur(year);expect(year).toHaveValue('2026');
  fireEvent.change(year,{target:{value:'2027'}});expect(change).toHaveBeenCalledWith('2027-10');
 });
});
