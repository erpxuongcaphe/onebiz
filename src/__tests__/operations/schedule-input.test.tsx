import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseScheduleDate, ScheduleDateInput, ScheduleTimeInput } from '@/components/operations/schedule-input';
vi.mock('@/components/ui/icon',()=>({Icon:()=>null}));
afterEach(cleanup);
describe('Hub local date and 24-hour fields',()=>{
  it.each([['29/02/2028','2028-02-29'],['17/10/2026','2026-10-17'],['31/02/2026',''],['29/02/2026',''],['10/17/2026',''],['2026-10-17',''],['','']])('parses %s without day/month ambiguity',(text,iso)=>expect(parseScheduleDate(text)).toBe(iso));
  it('shows dd/mm/yyyy but submits the same ISO date contract',()=>{
    render(<form aria-label="Lịch"><label htmlFor="day">Ngày</label><ScheduleDateInput id="day" name="day" defaultValue="2026-10-20" required/></form>);
    const input=screen.getByRole('textbox',{name:'Ngày'});
    expect(input).toHaveValue('20/10/2026');
    fireEvent.change(input,{target:{value:'21/10/2026'}});
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('day')).toBe('2026-10-21');
    fireEvent.change(input,{target:{value:'31/02/2026'}});
    expect(input).toBeInvalid();
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('day')).toBe('');
  });
  it('keeps a partial date while typing and updates when a common schedule is filled',()=>{
    const change=vi.fn();
    const view=render(<ScheduleDateInput aria-label="Ngày" value="" onValueChange={change}/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'20/10/'}});
    expect(screen.getByRole('textbox')).toHaveValue('20/10/');expect(change).toHaveBeenLastCalledWith('');
    view.rerender(<ScheduleDateInput aria-label="Ngày" value="2026-10-22" onValueChange={change}/>);
    expect(screen.getByRole('textbox')).toHaveValue('22/10/2026');expect(screen.getByRole('textbox')).toBeValid();
  });
  it('native calendar selection clears a previous invalid entry',()=>{
    render(<ScheduleDateInput aria-label="Ngày" name="day" min="2026-10-17"/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'01/10/2026'}});expect(screen.getByRole('textbox')).toBeInvalid();
    fireEvent.change(screen.getByLabelText('Chọn ngày từ lịch'),{target:{value:'2026-10-20'}});
    expect(screen.getByRole('textbox')).toHaveValue('20/10/2026');expect(screen.getByRole('textbox')).toBeValid();
  });
  it.each(['00:00','12:00','23:59'])('retains 24-hour time %s',time=>{
    render(<form aria-label="Lịch"><label>Giờ<ScheduleTimeInput name="time" defaultValue={time} required/></label></form>);
    expect(screen.getByRole('textbox')).toHaveValue(time);
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('time')).toBe(time);
  });
  it.each(['24:00','12:60','11:59 PM','9:30'])('rejects invalid time %s without submitting a misleading value',time=>{
    render(<form aria-label="Lịch"><ScheduleTimeInput name="time" required/></form>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:time}});
    expect(screen.getByRole('textbox')).toBeInvalid();
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('time')).toBe('');
  });
});
