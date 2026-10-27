import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NumericInput } from "@/components/ui/numeric-input";
afterEach(cleanup);
it("keeps four-decimal quantities through focus, entry and blur", () => {
  const change = vi.fn();
  render(<NumericInput aria-label="Số lượng" value={0.0042} decimals={4} min={0.0001} onChange={change} />);
  const field = screen.getByRole("textbox", { name: "Số lượng" });
  expect(field).toHaveValue("0.0042");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "1,234.0042" } });
  fireEvent.blur(field);
  expect(change).toHaveBeenLastCalledWith(1234.0042);
  expect(field).toHaveValue("1,234.0042");
});
it("keeps money's declared two-decimal precision separate", () => {
  const change = vi.fn();
  render(<NumericInput aria-label="Số tiền" value={1234.56789} decimals={2} onChange={change} />);
  expect(screen.getByRole("textbox", { name: "Số tiền" })).toHaveValue("1,234.57");
  expect(change).not.toHaveBeenCalled();
});
it("selects the full raw quantity after removing thousands separators, without reselecting during typing", () => {
  const change=vi.fn();
  render(<NumericInput aria-label="Tồn thực đếm" value={1620} decimals={4} onChange={change}/>);
  const field=screen.getByRole('textbox',{name:'Tồn thực đếm'}) as HTMLInputElement;
  expect(field).toHaveValue('1,620');
  act(()=>field.focus());
  expect(field).toHaveValue('1620');
  expect([field.selectionStart,field.selectionEnd]).toEqual([0,4]);
  const replacement=field.value.slice(0,field.selectionStart!)+"7"+field.value.slice(field.selectionEnd!);
  fireEvent.change(field,{target:{value:replacement}});
  expect(field).toHaveValue('7');expect(change).toHaveBeenLastCalledWith(7);
  expect([field.selectionStart,field.selectionEnd]).toEqual([1,1]);
  fireEvent.change(field,{target:{value:'75'}});expect(field).toHaveValue('75');
  expect([field.selectionStart,field.selectionEnd]).toEqual([2,2]);
});
it("keeps decimal money fully selected after its formatted value becomes editable", () => {
  render(<NumericInput aria-label="Tiền" value={1234567.89} decimals={2} onChange={vi.fn()}/>);
  const field=screen.getByRole('textbox',{name:'Tiền'}) as HTMLInputElement;
  act(()=>field.focus());expect(field).toHaveValue('1234567.89');
  expect([field.selectionStart,field.selectionEnd]).toEqual([0,10]);
});
