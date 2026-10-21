import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/shared/page-header";
afterEach(()=>{cleanup();vi.useRealTimers();});
describe("stock search toolbar",()=>{
 it("keeps the typed search visible and forwards Vietnamese names without losing text",()=>{
  vi.useFakeTimers();const changed=vi.fn();const v=render(<PageHeader title="Tồn kho" searchOnOwnRow searchPlaceholder="Theo mã hàng, tên hàng..." searchValue="" onSearchChange={changed} actions={[{label:"Nhập tồn kho đầu kỳ"},{label:"Nhập trực tiếp"},{label:"Chốt & khóa tồn kho"}]}/>);
  const input=screen.getByRole("textbox",{name:"Theo mã hàng, tên hàng..."});fireEvent.change(input,{target:{value:"Cà phê tươi"}});expect(input).toHaveValue("Cà phê tươi");expect(changed).not.toHaveBeenCalled();
  act(()=>vi.advanceTimersByTime(350));expect(changed).toHaveBeenLastCalledWith("Cà phê tươi");
  v.rerender(<PageHeader title="Tồn kho" searchOnOwnRow searchPlaceholder="Theo mã hàng, tên hàng..." searchValue="Cà phê tươi" onSearchChange={changed}/>);expect(input).toHaveValue("Cà phê tươi");
  v.rerender(<PageHeader title="Tồn kho" searchOnOwnRow searchPlaceholder="Theo mã hàng, tên hàng..." searchValue="" onSearchChange={changed}/>);expect(input).toHaveValue("");
 });
});
