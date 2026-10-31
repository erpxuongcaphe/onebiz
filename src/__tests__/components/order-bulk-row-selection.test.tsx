import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DataTable } from "@/components/shared/data-table";

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

describe("order bulk row identity", () => {
  it("keeps the original order IDs selected across server pages instead of row indexes", () => {
    const first = { id: "10000000-0000-4000-8000-000000000001", code: "DH000001" };
    const second = { id: "10000000-0000-4000-8000-000000000002", code: "DH000002" };
    const action = vi.fn();
    const props = {
      columns: [{ accessorKey: "code", header: "Mã đơn" }],
      getRowId: (row: typeof first) => row.id,
      selectable: true,
      pageSize: 1,
      pageCount: 2,
      total: 2,
      bulkActions: [{ label: "Xử lý đơn đã chọn", onClick: action }],
    };
    const { rerender } = render(<DataTable {...props} data={[first]} pageIndex={0} />);
    fireEvent.click(within(screen.getByRole("table")).getByRole("checkbox", { name: "Chọn dòng 1" }));
    rerender(<DataTable {...props} data={[second]} pageIndex={1} />);
    fireEvent.click(within(screen.getByRole("table")).getByRole("checkbox", { name: "Chọn dòng 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Xử lý đơn đã chọn" }));
    expect(action).toHaveBeenCalledExactlyOnceWith([second], [first.id, second.id]);
  });

  it("wires the order page to persistent invoice IDs", () => {
    const source = readFileSync("src/app/(main)/don-hang/dat-hang/page.tsx", "utf8");
    expect(source).toMatch(/<DataTable[\s\S]*?getRowId=\{\(row\) => row\.id\}/);
  });
});
