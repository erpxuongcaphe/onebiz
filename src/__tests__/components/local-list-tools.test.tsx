import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocalListTools, useLocalList } from "@/components/shared/local-list-tools";
import { queryLocalList } from "@/lib/local-list-query";

describe("local list search, filter and sort", () => {
  it("matches Vietnamese without accents, combines filters and sorts numbers before paging without mutating source", () => {
    const rows = [{ name: "Nguyễn Huyền Trang", branch: "kho", count: 20 }, { name: "Nguyễn Huyền Trang", branch: "quan", count: 2 }, { name: "Đào Huy", branch: "kho", count: 3 }];
    const options = { search: "nguyen trang", searchText: (r: typeof rows[number]) => r.name, matches: (r: typeof rows[number]) => r.branch === "kho", sortValue: (r: typeof rows[number]) => r.count, direction: "asc" as const };
    expect(queryLocalList(rows, options)).toEqual([rows[0]]);
    expect(queryLocalList(rows, { ...options, search: "", matches: () => true }).map(r => r.count)).toEqual([2, 3, 20]);
    expect(queryLocalList(rows, { ...options, search: "", matches: () => true, direction: "desc" }).map(r => r.count)).toEqual([20, 3, 2]);
    expect(rows.map(r => r.count)).toEqual([20, 2, 3]);
  });

  it("resets paging on search and reset, and keeps the selected sort", () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ name: `Nhân viên ${i}`, count: i }));
    function Fixture() {
      const list = useLocalList(rows, { searchText: r => r.name, filters: [], sorts: [{ key: "count", label: "Số", value: r => r.count }] });
      return <><LocalListTools list={list} placeholder="Tìm nhân viên" /><output>{list.rows.map(r => r.count).join(",")}</output></>;
    }
    render(<Fixture />);
    fireEvent.click(screen.getByRole("button", { name: "Sau" }));
    expect(screen.getByText(/Trang 2\/3/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm nhân viên" }), { target: { value: "44" } });
    expect(screen.getByText("1 / 45 kết quả")).toBeInTheDocument();
    expect(screen.getByText("44", { selector: "output" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đang tăng dần, đổi sang giảm dần" }));
    fireEvent.click(screen.getByRole("button", { name: "Xóa lọc" }));
    expect(screen.getByText(/Trang 1\/3/)).toBeInTheDocument();
    expect(screen.getByText(/^44,43,42/, { selector: "output" })).toBeInTheDocument();
  });
});
