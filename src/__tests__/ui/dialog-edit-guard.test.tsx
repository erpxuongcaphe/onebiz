import { useState } from "react";
import { act, cleanup, fireEvent, render as baseRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { PageLeaveGuard } from "@/components/shared/page-leave-guard";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const render = (element: ReactElement) => baseRender(<><PageLeaveGuard />{element}</>);
function Form({ sheet = false, saved = vi.fn() }) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  const [rows, setRows] = useState(0);
  const Root = sheet ? Sheet : Dialog;
  const Content = sheet ? SheetContent : DialogContent;
  const Title = sheet ? SheetTitle : DialogTitle;
  return <Root open={open} onOpenChange={setOpen}><Content>
    <Title>Phiếu thử</Title><input aria-label="Tên công việc" value={value} onChange={e => setValue(e.target.value)} />
    <input type="checkbox" aria-label="Cần minh chứng" />
    <button onClick={() => setRows(r => r + 1)}>Thêm dòng</button>
    {Array.from({ length: rows }, (_, index) => <input key={index} aria-label={`Dòng ${index + 1}`} defaultValue="1" />)}
    <button aria-label="Đóng phiếu" onClick={() => setOpen(false)}>Đóng</button>
    <button onClick={() => setOpen(false)}>Hủy</button>
    <button onClick={() => { saved(); setOpen(false); }}>Lưu</button>
  </Content></Root>;
}
const change = () => fireEvent.change(screen.getByLabelText("Tên công việc"), { target: { value: "Việc đang nhập" } });
const discard = () => fireEvent.click(screen.getByRole("button", { name: "Bỏ thay đổi và đóng" }));

describe("shared popup edit guard", () => {
  it("asks only once for a link inside an edited popup", async () => {
    const navigate = vi.fn();
    render(<Dialog defaultOpen><DialogContent><DialogTitle>Phiếu liên kết</DialogTitle><input aria-label="Nội dung" /><a href="/other" onClick={event => { event.preventDefault(); navigate(); }}>Trang khác</a></DialogContent></Dialog>);
    fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "Chưa lưu" } });
    fireEvent.click(screen.getByText("Trang khác")); expect(navigate).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText("Bỏ thay đổi và rời trang"));
    expect(navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument());
  });
  it("blocks history traversal until discard is approved and removes its listener", async () => {
    const navigation = new EventTarget() as EventTarget & { traverseTo: ReturnType<typeof vi.fn>; currentEntry: {key:string} };
    navigation.traverseTo = vi.fn(() => ({ finished: Promise.resolve() }));
    navigation.currentEntry = {key:"current"};
    vi.stubGlobal("navigation", navigation);
    const routerRestore = vi.fn();
    window.addEventListener("popstate", routerRestore);
    const move = () => {
      const event = new Event("navigate", { cancelable: true });
      Object.assign(event, { navigationType: "traverse", destination: { key: "previous", sameDocument: true } });
      act(() => { navigation.dispatchEvent(event); });
      return event;
    };
    const view = render(<Form />);
    expect(move().defaultPrevented).toBe(false);
    const traverse = () => {
      move(); navigation.currentEntry={key:"previous"};
      act(()=>window.dispatchEvent(new PopStateEvent("popstate")));
      expect(navigation.traverseTo).toHaveBeenLastCalledWith("current");
      navigation.currentEntry={key:"current"};
      act(()=>window.dispatchEvent(new PopStateEvent("popstate")));
    };
    change(); traverse();
    expect(routerRestore).not.toHaveBeenCalled();
    await screen.findByText("Có nội dung chưa lưu");
    fireEvent.click(screen.getByRole("button", { name: "Quay lại để lưu" }));
    expect(screen.getByLabelText("Tên công việc")).toHaveValue("Việc đang nhập");
    expect(navigation.currentEntry.key).toBe("current");
    traverse();
    fireEvent.click(await screen.findByRole("button", { name: "Bỏ thay đổi và rời trang" }));
    expect(navigation.traverseTo).toHaveBeenCalledWith("previous");
    navigation.currentEntry={key:"previous"};
    act(()=>window.dispatchEvent(new PopStateEvent("popstate")));
    expect(routerRestore).toHaveBeenCalledTimes(1);
    expect(move().defaultPrevented).toBe(false);
    view.unmount(); expect(move().defaultPrevented).toBe(false);
    window.removeEventListener("popstate", routerRestore);
  });
  it("does not dismiss after an outside click", async () => {
    render(<Form />);
    fireEvent.pointerDown(document.body); fireEvent.pointerUp(document.body); fireEvent.click(document.body);
    expect(screen.getByRole("dialog", { name: "Phiếu thử" })).toBeInTheDocument();
  });
  it("guards direct cancel callbacks and preserves data when continuing", async () => {
    render(<Form />); change(); fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(await screen.findByText("Có nội dung chưa lưu")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Quay lại để lưu" }));
    expect(screen.getByLabelText("Tên công việc")).toHaveValue("Việc đang nhập");
  });
  it("discards only after explicit confirmation", async () => {
    render(<Form />); change(); fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await screen.findByText("Có nội dung chưa lưu"); discard();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("guards the standard X button", async () => {
    render(<Form />); change(); fireEvent.click(screen.getByRole("button", { name: /^Đóng$/ }));
    await screen.findByText("Có nội dung chưa lưu"); discard();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("guards a custom Hub-style X by aria-label", async () => {
    function Custom() { const [open, setOpen] = useState(true); return <Dialog open={open} onOpenChange={setOpen}><DialogContent showCloseButton={false}><DialogTitle>Hub</DialogTitle><input aria-label="Nội dung" /><button aria-label="Đóng" onClick={() => setOpen(false)}>X</button></DialogContent></Dialog>; }
    render(<Custom />); fireEvent.change(screen.getByLabelText("Nội dung"), { target: { value: "Chưa lưu" } });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" })); await screen.findByText("Có nội dung chưa lưu");
  });
  it("guards Escape and keeps changes when cancelling the confirmation", async () => {
    render(<Form />); change(); fireEvent.keyDown(screen.getByLabelText("Tên công việc"), { key: "Escape" });
    await screen.findByText("Có nội dung chưa lưu"); fireEvent.click(screen.getByRole("button", { name: "Quay lại để lưu" }));
    expect(screen.getByLabelText("Tên công việc")).toHaveValue("Việc đang nhập");
  });
  it("does not interfere with successful business save", async () => {
    const saved = vi.fn(); render(<Form saved={saved} />); change(); fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(saved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument());
  });
  it("does not warn for a clean form or reverted text", async () => {
    render(<Form />); change(); fireEvent.change(screen.getByLabelText("Tên công việc"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("captures rows added without an input change event", async () => {
    render(<Form />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "Thêm dòng" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm dòng" }));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" })); await screen.findByText("Có nội dung chưa lưu");
  });
  it("detects checkbox changes", async () => {
    render(<Form />); fireEvent.click(screen.getByLabelText("Cần minh chứng"));
    fireEvent.click(screen.getByRole("button", { name: "Hủy" })); await screen.findByText("Có nội dung chưa lưu");
  });
  it("protects sheets using the same guard", async () => {
    render(<Form sheet />); change(); fireEvent.click(screen.getByRole("button", { name: "Hủy" })); await screen.findByText("Có nội dung chưa lưu");
  });
  it("protects uncontrolled dialogs too", async () => {
    render(<Dialog defaultOpen><DialogContent><DialogTitle>Không điều khiển</DialogTitle><input aria-label="Ghi chú" /><DialogClose>Hủy</DialogClose></DialogContent></Dialog>);
    fireEvent.change(screen.getByLabelText("Ghi chú"), { target: { value: "Đang làm" } }); fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await screen.findByText("Có nội dung chưa lưu"); discard(); await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("adds unload protection only while unsaved work exists", async () => {
    render(<Form />);
    const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
    change(); const dirty = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const saved = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false);
  });
  it("keeps read-only details freely closable", async () => {
    function Details() { const [open, setOpen] = useState(true); return <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Chi tiết</DialogTitle><p>Đã lưu</p></DialogContent></Dialog>; }
    render(<Details />); fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
