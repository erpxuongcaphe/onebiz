import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { FilterPanel } from "@/components/shared/filter-sidebar/filter-panel";
vi.mock("@/lib/hooks/use-breakpoint", () => ({ useBreakpoint: () => true }));
afterEach(cleanup);
function Fixture() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  return (
    <>
      <span>Kết quả {value}</span>
      <FilterPanel open={open} onOpenChange={setOpen}>
        <label>
          Mã chứng từ
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
      </FilterPanel>
    </>
  );
}
describe("filter panel is navigation, not an unsaved transaction", () => {
  it("closes from the fixed result action after changing filters without a discard prompt", () => {
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText("Mã chứng từ"), {
      target: { value: "PC000333" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Xem kết quả" }));
    expect(screen.queryByText("Có nội dung chưa lưu")).toBeNull();
    expect(screen.getByText("Kết quả PC000333")).toBeInTheDocument();
  });
  it("allows Escape after a filter edit without treating it as a financial form", () => {
    render(<Fixture />);
    fireEvent.change(screen.getByLabelText("Mã chứng từ"), {
      target: { value: "PO000406" },
    });
    fireEvent.keyDown(screen.getByLabelText("Mã chứng từ"), { key: "Escape" });
    expect(screen.queryByText("Có nội dung chưa lưu")).toBeNull();
  });
});
