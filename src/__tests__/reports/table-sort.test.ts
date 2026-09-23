import { describe, expect, it } from "vitest";
import { sortReportRows } from "@/lib/reports/table-sort";

describe("report table ordering", () => {
  const rows = [
    { name: "Món 10", amount: 40 },
    { name: "Món 2", amount: 5 },
    { name: "Món 1", amount: 40 },
    { name: "Chưa rõ", amount: null },
  ];

  it("sorts numeric measures before pagination and keeps missing values last", () => {
    expect(sortReportRows(rows, (row) => row.amount, "desc").map((row) => row.name))
      .toEqual(["Món 10", "Món 1", "Món 2", "Chưa rõ"]);
    expect(rows[0].name).toBe("Món 10");
  });

  it("orders Vietnamese labels naturally and stably", () => {
    expect(sortReportRows(rows, (row) => row.name, "asc").map((row) => row.name))
      .toEqual(["Chưa rõ", "Món 1", "Món 2", "Món 10"]);
  });
});
