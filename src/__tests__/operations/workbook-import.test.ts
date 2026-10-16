import { describe, it, expect } from "vitest";
import { ceoWorkingRows, parseWorkingWorkbook, workingHeaders, workingImportSchema } from "@/lib/operations/workbook-import";
const sourceRows = () => ceoWorkingRows.map((row) => [row.number, row.group, row.title, row.requirement, row.scope, row.frequency === "daily" ? "Daily" : "Weekly", row.points]);
describe("CEO workbook source and editable import", () => {
  it("keeps 34 rows, 32 daily, 2 weekly, two distinct same-name requirements", () => {
    expect(ceoWorkingRows).toHaveLength(34);
    expect(ceoWorkingRows.filter((row) => row.frequency === "daily")).toHaveLength(32);
    expect(ceoWorkingRows.filter((row) => row.frequency === "weekly")).toHaveLength(2);
    expect(ceoWorkingRows.filter((row) => row.title === "Nguyên liệu")).toHaveLength(2);
    expect(ceoWorkingRows.filter((row) => row.points > 0).map((row) => row.number)).toEqual([13, 18]);
  });
  it("accepts the original workbook's blank leading rows and column", () => {
    const result = parseWorkingWorkbook([[], [], [], [null, ...workingHeaders], ...sourceRows().map((row) => [null, ...row])]);
    expect(result.errors).toEqual([]); expect(result.rows).toEqual(ceoWorkingRows);
  });
  it("accepts Unicode minus but never interprets commas as decimal points", () => {
    const rows = sourceRows(); rows[0][6] = "−5"; expect(parseWorkingWorkbook([workingHeaders, ...rows]).errors).toEqual([]);
    rows[0][6] = "5,5"; expect(parseWorkingWorkbook([workingHeaders, ...rows]).errors[0]).toMatchObject({ row: 2, column: "Điểm" });
  });
  it("supports added, edited and removed criteria without locking to 34", () => {
    const row = { ...ceoWorkingRows[0], number: 101, group: "Nhóm CEO tự tạo", title: "Công việc mới", requirement: "Yêu cầu mới", points: -3 };
    const result = parseWorkingWorkbook([workingHeaders, [row.number, row.group, row.title, row.requirement, row.scope, "Daily", row.points]]);
    expect(result.errors).toEqual([]); expect(result.rows[0]).toEqual(row);
  });
  it("reports duplicate row numbers, not duplicate names", () => {
    const rows = sourceRows(); rows[1][0] = rows[0][0];
    expect(parseWorkingWorkbook([workingHeaders, ...rows]).errors).toContainEqual(expect.objectContaining({ row: 3, column: "STT" }));
  });
  it("requires explicit branch/user/schedule before any write", () => {
    expect(workingImportSchema.safeParse({ requestId: crypto.randomUUID(), rows: ceoWorkingRows, assignments: [], effectiveFrom: "2026-10-16", dueTime: "", weeklyDay: 0 }).success).toBe(false);
  });
});
