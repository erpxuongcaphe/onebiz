import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterChips } from "@/components/shared/filter-chips";
import { ListStrip } from "@/components/shared/list-strip";

describe("nền bố cục danh sách", () => {
  it("dải gọn phân tách chỉ số và công cụ", () => {
    render(
      <ListStrip metrics={<span>34 hóa đơn</span>} tools={<button>Cột</button>} />,
    );
    const strip = screen.getByRole("region", {
      name: "Chỉ số và công cụ danh sách",
    });
    expect(strip.className).toContain("h-12");
    expect(screen.getByText("34 hóa đơn")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cột" })).toBeTruthy();
  });

  it("không dựng hàng chip khi chưa lọc", () => {
    const { container } = render(<FilterChips filters={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("xóa từng điều kiện hoặc xóa tất cả mà vẫn giữ một hàng", () => {
    const clearBranch = vi.fn();
    const clearAll = vi.fn();
    render(
      <FilterChips
        filters={[
          {
            key: "branch",
            label: "Chi nhánh",
            value: "Kho Tổng",
            onClear: clearBranch,
          },
          {
            key: "status",
            label: "Trạng thái",
            value: "Hoàn thành",
            onClear: vi.fn(),
          },
        ]}
        onClearAll={clearAll}
      />,
    );

    const row = screen.getByLabelText("Đang lọc 2 điều kiện");
    expect(row.className).toContain("h-7");
    expect(row.className).toContain("overflow-x-auto");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Xóa lọc Chi nhánh: Kho Tổng",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    expect(clearBranch).toHaveBeenCalledTimes(1);
    expect(clearAll).toHaveBeenCalledTimes(1);
  });
});

