import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { FilterChips } from "@/components/shared/filter-chips";
import { ListStrip } from "@/components/shared/list-strip";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterPanel } from "@/components/shared/filter-sidebar";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

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

  it("chỉ số gọn lọc được bằng chuột và bàn phím", () => {
    const onClick = vi.fn();
    render(
      <ListMetric
        label="Hoàn thành"
        value="212"
        onClick={onClick}
        selected
      />,
    );
    const metric = screen.getByRole("button", { name: "Hoàn thành: 212" });
    expect(metric.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(metric);
    expect(onClick).toHaveBeenCalledTimes(1);
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

  it("panel lọc chỉ có lệnh xóa, không tạo nút áp dụng", () => {
    const clearAll = vi.fn();
    render(
      <FilterPanel
        open
        onOpenChange={vi.fn()}
        activeCount={3}
        onClearAll={clearAll}
      >
        <label>
          Trạng thái
          <input type="checkbox" />
        </label>
      </FilterPanel>,
    );

    expect(screen.getByText("Bộ lọc")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /áp dụng/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Xóa tất cả" }));
    expect(clearAll).toHaveBeenCalledTimes(1);
  });

  it("PageHeader chỉ gọn khi trang chủ động bật", () => {
    const { rerender } = render(<PageHeader title="Hóa đơn" />);
    expect(screen.getByRole("heading", { name: "Hóa đơn" }).className).toContain(
      "text-2xl",
    );
    rerender(<PageHeader title="Hóa đơn" density="compact" />);
    expect(screen.getByRole("heading", { name: "Hóa đơn" }).className).toContain(
      "text-xl",
    );
  });

  it("DataTable cho tắt hàng hiển thị cột và dùng mật độ gọn", () => {
    type Row = { code: string };
    const columns: ColumnDef<Row>[] = [
      { accessorKey: "code", header: "Mã", cell: ({ row }) => row.original.code },
    ];
    render(
      <DataTable
        columns={columns}
        data={[{ code: "HD001" }]}
        columnToggle
        columnToggleToolbar={false}
        density="compact"
      />,
    );
    expect(screen.queryByText("Hiển thị cột")).toBeNull();
    const value = screen.getAllByText("HD001").find((node) => node.tagName === "TD");
    expect(value?.closest("td")?.className).toContain("py-2");
  });

  it("DataTable gom chỉ số, lọc và menu cột vào cùng một dải", () => {
    type Row = { code: string };
    const columns: ColumnDef<Row>[] = [
      { accessorKey: "code", header: "Mã", cell: ({ row }) => row.original.code },
    ];
    render(
      <DataTable
        columns={columns}
        data={[{ code: "HD001" }]}
        columnToggle
        toolbarMetrics={<span>260 hóa đơn</span>}
        toolbarActions={<button>Bộ lọc</button>}
        toolbarFooter={
          <FilterChips
            filters={[
              {
                key: "status",
                label: "Trạng thái",
                value: "Hoàn thành",
                onClear: vi.fn(),
              },
            ]}
          />
        }
      />,
    );

    expect(
      screen.getByRole("region", { name: "Chỉ số và công cụ danh sách" }),
    ).toBeTruthy();
    expect(screen.getByText("260 hóa đơn")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bộ lọc" })).toBeTruthy();
    expect(screen.getByText("Hiển thị cột")).toBeTruthy();
    expect(screen.getAllByText("Hiển thị cột")).toHaveLength(1);
    expect(screen.getByLabelText("Đang lọc 1 điều kiện")).toBeTruthy();
  });
});
