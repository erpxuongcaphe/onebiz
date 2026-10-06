import { useState } from "react";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportDataTable } from "@/components/shared/report/report-data-table";
import { sortReportRows } from "@/lib/reports/table-sort";

vi.mock("next/navigation", () => ({ usePathname: () => "/phan-tich/xuat-nhap-ton" }));
afterEach(cleanup);

const rows = [{ code: "B", qty: 2 }, { code: "A", qty: 10 }, { code: "C", qty: 1 }];

function Report() {
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);
  const result = sort ? sortReportRows(rows, (row) => row[sort.id as keyof typeof row], sort.direction) : rows;
  return <>
    <output aria-label="Export order">{result.map((row) => row.code).join(",")}</output>
    <ReportDataTable columns={[{ label: "Mã", key: "code" }, { label: "SL", key: "qty" }]}
      rows={result} getRowKey={(row) => row.code} sortState={sort} onSortChange={setSort}
      showDisplayOptions={false} />
  </>;
}

describe("report sorting shared with export rows", () => {
  it("uses numeric sorting and shares both directions with the complete export", () => {
    render(<Report />);
    fireEvent.click(screen.getByRole("button", { name: "Sắp xếp SL tăng dần" }));
    expect(screen.getByLabelText("Export order").textContent).toBe("C,B,A");
    fireEvent.click(screen.getByRole("button", { name: "Sắp xếp SL giảm dần" }));
    expect(screen.getByLabelText("Export order").textContent).toBe("A,B,C");
    expect(rows.map((row) => row.code)).toEqual(["B", "A", "C"]);
  });
  it("keeps standalone table sorting backward compatible", () => {
    render(<ReportDataTable columns={[{ label: "Mã", key: "code" }]}
      rows={rows} getRowKey={(row) => row.code} showDisplayOptions={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Sắp xếp Mã tăng dần" }));
    expect(screen.getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual(["A", "B", "C"]);
  });
});
