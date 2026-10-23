import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InlineDetailPanel } from "@/components/shared/inline-detail-panel/inline-detail-panel";
import { DetailTabs } from "@/components/shared/inline-detail-panel/detail-tabs";

const tabs = [
  { id: "info", label: "Thông tin", content: <p>Thông tin hóa đơn</p> },
  { id: "payments", label: "Thanh toán", content: <p>Lịch sử thanh toán</p> },
  { id: "history", label: "Lịch sử", content: <p>Lịch sử thay đổi</p> },
];
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
beforeEach(() => {
  window.sessionStorage.clear();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  if (scrollDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("invoice detail action separation", () => {
  it("puts dangerous actions in a separate in-flow group before the tabs", () => {
    const onDelete = vi.fn();
    render(<InlineDetailPanel open actionLayout="separate" onClose={vi.fn()} onDelete={onDelete} deleteLabel="Hủy & hoàn tác">
      <DetailTabs tabs={tabs} />
    </InlineDetailPanel>);
    const actions = screen.getByRole("group", { name: "Thao tác chi tiết" });
    expect(actions).not.toHaveClass("absolute");
    expect(actions).toHaveClass("flex-wrap", "border-b");
    expect(within(actions).getByRole("button", { name: "Hủy & hoàn tác" })).toHaveClass("min-h-11");
    expect(within(actions).getByRole("button", { name: "Đóng" })).toHaveClass("size-11");
    fireEvent.click(screen.getByRole("button", { name: "Thanh toán" }));
    expect(screen.getByText("Lịch sử thanh toán")).toBeVisible();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("preserves callbacks and stops action clicks from toggling the parent row", () => {
    const rowClick=vi.fn(), edit=vi.fn(), cancel=vi.fn(), close=vi.fn();
    render(<div onClick={rowClick}><InlineDetailPanel open actionLayout="separate"
      onClose={close} onEdit={edit} onDelete={cancel} deleteLabel="Hủy & hoàn tác"><p>Chi tiết</p></InlineDetailPanel></div>);
    fireEvent.click(screen.getByRole("button",{name:"Sửa"}));
    fireEvent.click(screen.getByRole("button",{name:"Hủy & hoàn tác"}));
    fireEvent.click(screen.getByRole("button",{name:"Đóng"}));
    expect(edit).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("does not add edit or cancel controls without callbacks", () => {
    render(<InlineDetailPanel open actionLayout="separate" onClose={vi.fn()}><p>Chi tiết</p></InlineDetailPanel>);
    expect(within(screen.getByRole("group")).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button",{name:"Xóa"})).toBeNull();
  });

  it("keeps the previous layout as default for other pages", () => {
    render(<InlineDetailPanel open onClose={vi.fn()}><p>Chi tiết</p></InlineDetailPanel>);
    expect(screen.getByRole("group")).toHaveClass("absolute");
  });

  it("retains the payment tab when the same invoice detail remounts", () => {
    const first=render(<DetailTabs tabs={tabs} persistenceKey="invoice:test-a" />);
    fireEvent.click(screen.getByRole("button",{name:"Thanh toán"}));
    first.unmount();
    render(<DetailTabs tabs={tabs} persistenceKey="invoice:test-a" />);
    expect(screen.getByText("Lịch sử thanh toán")).toBeVisible();
  });

  it("opts in only at the invoice detail and scopes the tab preference by invoice", () => {
    const page=readFileSync("src/app/(main)/don-hang/hoa-don/page.tsx","utf8");
    expect(page).toContain('actionLayout="separate"');
    expect(page).toContain('persistenceKey={`invoice:${invoice.id}`}');
  });
});
