import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock("@/lib/hooks/use-breakpoint", () => ({ useBreakpoint: () => viewport.desktop }));
import { FilterPanel } from "@/components/shared/filter-sidebar/filter-panel";
import { FilterGroup } from "@/components/shared/filter-sidebar/filter-sidebar";
import { DatePresetFilter, type DatePresetValue } from "@/components/shared/filter-sidebar/date-preset-filter";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [checked, setChecked] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Mở bộ lọc</button>
    <output aria-label="Kết quả">{text}:{String(checked)}</output>
    <FilterPanel open={open} onOpenChange={setOpen} activeCount={Number(!!text) + Number(checked)} onClearAll={() => { setText(""); setChecked(false); }}>
      <FilterGroup label="Chứng từ"><label>Mã chứng từ<input value={text} onChange={event => setText(event.target.value)} /></label></FilterGroup>
      <FilterGroup label="Trạng thái"><label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />Hoàn tất</label></FilterGroup>
    </FilterPanel>
  </>;
}
beforeEach(() => { viewport.desktop = true; });
afterEach(cleanup);
describe("filter panel UX contract", () => {
  it.each([true, false])("preserves live filtering, explicit close and reopening at desktop=%s", async desktop => {
    viewport.desktop = desktop; render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Mở bộ lọc" }));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", desktop ? "left" : "bottom");
    fireEvent.change(screen.getByLabelText("Mã chứng từ"), { target: { value: "TEST-001" } });
    fireEvent.click(screen.getByLabelText("Hoàn tất"));
    expect(screen.getByLabelText("Kết quả")).toHaveTextContent("TEST-001:true");
    expect(screen.getByLabelText("2 điều kiện đang lọc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng bộ lọc" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Kết quả")).toHaveTextContent("TEST-001:true");
    fireEvent.click(screen.getByRole("button", { name: "Mở bộ lọc" }));
    expect(screen.getByLabelText("Mã chứng từ")).toHaveValue("TEST-001");
    expect(screen.getByLabelText("Hoàn tất")).toBeChecked();
  });
  it("clears values without closing; the result action only closes", async () => {
    render(<Fixture />); fireEvent.click(screen.getByRole("button", { name: "Mở bộ lọc" }));
    fireEvent.change(screen.getByLabelText("Mã chứng từ"), { target: { value: "TEST-002" } });
    fireEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Kết quả")).toHaveTextContent(":false");
    fireEvent.click(screen.getByRole("button", { name: "Xem kết quả" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
  it("Escape closes after an edit without clearing it or opening a discard prompt", async () => {
    render(<Fixture />); fireEvent.click(screen.getByRole("button", { name: "Mở bộ lọc" }));
    fireEvent.change(screen.getByLabelText("Mã chứng từ"), { target: { value: "TEST-003" } });
    fireEvent.keyDown(screen.getByLabelText("Mã chứng từ"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Kết quả")).toHaveTextContent("TEST-003:false");
    expect(screen.queryByText("Có nội dung chưa lưu")).not.toBeInTheDocument();
  });
  it("keeps group actions outside the disclosure button", () => {
    const action = vi.fn();
    render(<FilterGroup label="Nhóm thử" action={<button onClick={action}>Tạo mới</button>}><p>Nội dung nhóm</p></FilterGroup>);
    expect(screen.getByRole("button", { name: "Tạo mới" }).parentElement?.closest("button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tạo mới" }));
    expect(action).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Nhóm thử" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Nhóm thử" }));
    expect(screen.queryByText("Nội dung nhóm")).not.toBeInTheDocument();
  });
  it("preserves date preset values and custom date callbacks without adding options", () => {
    const change = vi.fn(), from = vi.fn(), to = vi.fn();
    render(<DatePresetFilter value="custom" onChange={change} from="2026-10-01" to="2026-10-21" onFromChange={from} onToChange={to} presets={[{ label: "Hôm nay", value: "today" }, { label: "Tùy chỉnh", value: "custom" as DatePresetValue }]} />);
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: /Hôm nay/ }));
    expect(change).toHaveBeenCalledExactlyOnceWith("today");
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-10-02" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-10-20" } });
    expect(from).toHaveBeenCalledExactlyOnceWith("2026-10-02");
    expect(to).toHaveBeenCalledExactlyOnceWith("2026-10-20");
  });
});
