import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PageLeaveGuard } from "@/components/shared/page-leave-guard";
import { useUnsavedSnapshot, useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { captureFormSave, createFormEditTracker } from "@/lib/utils/form-edit-tracker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const unload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
function Settings({ failed = false }) {
  const [value, setValue] = useState("Ban đầu");
  const markSaved = useUnsavedSnapshot(value);
  return <><input aria-label="Cài đặt" value={value} onChange={e => setValue(e.target.value)} />
    <button onClick={() => { if (!failed) markSaved(value); }}>Lưu cài đặt</button>
    <a href="/other">Trang khác</a></>;
}
describe("global page leave guard", () => {
  it("protects a page editor, returns without loss and clears only after save", async () => {
    render(<><PageLeaveGuard /><Settings /></>);
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Cài đặt"), { target: { value: "Chưa lưu" } });
    expect(unload()).toBe(true);
    fireEvent.click(screen.getByText("Trang khác"));
    await screen.findByText("Có nội dung chưa lưu");
    fireEvent.click(screen.getByText("Quay lại để lưu"));
    expect(screen.getByLabelText("Cài đặt")).toHaveValue("Chưa lưu");
    fireEvent.click(screen.getByText("Lưu cài đặt")); expect(unload()).toBe(false);
  });
  it("keeps protection when saving fails", () => {
    render(<><PageLeaveGuard /><Settings failed /></>);
    fireEvent.change(screen.getByLabelText("Cài đặt"), { target: { value: "Chưa lưu" } });
    fireEvent.click(screen.getByText("Lưu cài đặt")); expect(unload()).toBe(true);
  });
  it("does not clear another editor after a partial save", () => {
    function Multiple() {
      const [a, setA] = useState(""), [b, setB] = useState("");
      const saveA = useUnsavedSnapshot(a); useUnsavedSnapshot(b);
      return <><input aria-label="A" value={a} onChange={e=>setA(e.target.value)} /><input aria-label="B" value={b} onChange={e=>setB(e.target.value)} /><button onClick={()=>saveA(a)}>Lưu A</button></>;
    }
    render(<><PageLeaveGuard /><Multiple /></>);
    fireEvent.change(screen.getByLabelText("A"), {target:{value:"a"}}); fireEvent.change(screen.getByLabelText("B"), {target:{value:"b"}});
    fireEvent.click(screen.getByText("Lưu A")); expect(unload()).toBe(true);
  });
  it("protects custom page close commands before running them", async () => {
    const close = vi.fn();
    function Dirty() { useUnsavedWork(true); return <button data-page-close onClick={close}>Đăng xuất</button>; }
    render(<><PageLeaveGuard /><Dirty /></>);
    fireEvent.click(screen.getByText("Đăng xuất")); expect(close).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Bỏ thay đổi và rời trang")); expect(close).toHaveBeenCalledTimes(1);
  });
  it("captures native forms without including filter-only fields", () => {
    render(<><PageLeaveGuard /><form><input aria-label="Nội dung" defaultValue="" /><input aria-label="Tìm" type="search" /></form></>);
    fireEvent.focusIn(screen.getByLabelText("Nội dung")); fireEvent.change(screen.getByLabelText("Tìm"), {target:{value:"lọc"}});
    expect(unload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Nội dung"), {target:{value:"việc"}}); expect(unload()).toBe(true);
  });
  it("acknowledges exactly the native payload saved, retaining later edits", () => {
    const form = document.createElement("form"); form.innerHTML='<input name="title" value="old">'; document.body.append(form);
    const tracker = createFormEditTracker(); const input = form.querySelector("input")!;
    const event = new Event("focusin"); Object.defineProperty(event,"target",{value:input}); tracker.before(event);
    input.value="submitted"; const saved = captureFormSave(form); input.value="newer"; saved(); expect(tracker.dirty()).toBe(true);
    input.value="submitted"; expect(tracker.dirty()).toBe(false); form.remove(); expect(tracker.dirty()).toBe(false);
  });
  it("does not flag async initial data as edits or forget edits made during save", () => {
    let acknowledge: (saved: string) => void = () => {};
    function Loaded({value,ready}:{value:string;ready:boolean}) { const saved=useUnsavedSnapshot(value,ready); useEffect(()=>{acknowledge=saved;},[saved]); return null; }
    const view=render(<><PageLeaveGuard /><Loaded value="" ready={false} /></>);
    view.rerender(<><PageLeaveGuard /><Loaded value="loaded" ready /></>); expect(unload()).toBe(false);
    view.rerender(<><PageLeaveGuard /><Loaded value="submitted" ready /></>);
    view.rerender(<><PageLeaveGuard /><Loaded value="newer" ready /></>);
    act(()=>acknowledge("submitted")); expect(unload()).toBe(true);
  });
});
