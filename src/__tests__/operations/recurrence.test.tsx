import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RecurrenceFields } from "@/components/operations/recurrence-fields";
import { recurrenceSchema, scheduleSummary, type ScheduleFrequency } from "@/lib/operations/recurrence";
import { ceoWorkingRows, parseWorkingWorkbook, workingHeaders } from "@/lib/operations/workbook-import";

afterEach(cleanup);

function Editor() {
  const [frequency, setFrequency] = useState<ScheduleFrequency | "event">("once");
  const [day, setDay] = useState(1);
  const [month, setMonth] = useState(1);
  return <form aria-label="Lịch"><RecurrenceFields name="frequency" frequency={frequency} onChange={setFrequency} dayNumber={day} onDayChange={setDay} monthNumber={month} onMonthChange={setMonth}/></form>;
}

describe("Shared Hub recurrence contract", () => {
  it.each(["once", "daily", "weekly"])("keeps the original branch fallback for %s", frequency => {
    expect(recurrenceSchema.safeParse({ frequency }).success).toBe(true);
  });
  it.each([
    { frequency: "weekly", dayNumber: 8 },
    { frequency: "monthly" },
    { frequency: "quarterly", dayNumber: 31, monthNumber: 4 },
    { frequency: "yearly", dayNumber: 29 },
    { frequency: "yearly", dayNumber: 1, monthNumber: 13 },
  ])("rejects an incomplete or misleading schedule %j", value => {
    expect(recurrenceSchema.safeParse(value).success).toBe(false);
  });
  it("starts as one-off and only reveals repeat fields when requested", () => {
    render(<Editor/>);
    expect(screen.getByRole("checkbox", { name: "Lặp lại" })).not.toBeChecked();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("Chu kỳ"), { target: { value: "quarterly" } });
    expect(screen.getByLabelText("Tháng trong quý").children).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Ngày trong tháng"), { target: { value: "31" } });
    expect(screen.getByText(/đến hạn vào ngày cuối tháng/)).toBeInTheDocument();
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("frequency")).toBe("quarterly");
    fireEvent.click(screen.getByRole("checkbox"));
    const form = new FormData(screen.getByRole("form") as HTMLFormElement);
    expect(form.get("frequency")).toBe("once");
    expect(form.has("monthNumber")).toBe(false);
    expect(form.has("dayNumber")).toBe(false);
  });
  it("provides clear summaries without exposing internal codes", () => {
    expect(scheduleSummary("weekly", 7)).toBe("Mỗi Chủ nhật");
    expect(scheduleSummary("quarterly", 15, 2)).toBe("Ngày 15, tháng thứ 2 mỗi quý");
    expect(scheduleSummary("yearly", 29, 2)).toBe("Ngày 29/2 hằng năm");
  });
  it("round-trips optional Excel recurrence columns and preserves old 34-row workbooks", () => {
    const old = ceoWorkingRows.map(row => [row.number, row.group, row.title, row.requirement, row.scope, row.frequency, row.points]);
    expect(parseWorkingWorkbook([workingHeaders, ...old]).rows).toEqual(ceoWorkingRows);
    const headers = [...workingHeaders, "Ngày lặp", "Tháng lặp"];
    const result = parseWorkingWorkbook([headers, [...old[0].slice(0, 5), "Hằng quý", -5, 31, 2]]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ frequency: "quarterly", dayNumber: 31, monthNumber: 2 });
    const invalid = parseWorkingWorkbook([headers, [...old[0].slice(0, 5), "Hằng năm", -5, 15, 13]]);
    expect(invalid.errors).toContainEqual(expect.objectContaining({ row: 2, column: "Tháng lặp" }));
  });
});
