import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SummaryCard } from "@/components/shared/summary-card";

describe("SummaryCard tương tác", () => {
  it("không có lệnh thì chỉ là khối thông tin", () => {
    render(<SummaryCard label="Tổng" value="12" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("có lệnh thì là nút bàn phím được và báo trạng thái đang chọn", () => {
    const onClick = vi.fn();
    render(
      <SummaryCard
        label="Hoàn thành"
        value="10"
        onClick={onClick}
        selected
        ariaLabel="Lọc hóa đơn hoàn thành"
      />,
    );
    const button = screen.getByRole("button", { name: "Lọc hóa đơn hoàn thành" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("đang tải thì không cho đổi bộ lọc", () => {
    const onClick = vi.fn();
    render(
      <SummaryCard label="Đã hủy" value="—" onClick={onClick} loading />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
