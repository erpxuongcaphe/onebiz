import { describe, expect, it } from "vitest";
import { filterDates, filterParams, filteredPageSchema, initialFilters, matchesConfiguration } from "@/lib/operations/filters";
describe("Hub filters", () => {
  const vnMidnight = new Date("2026-10-10T17:15:00Z");
  it("uses Vietnam today, not the host date", () => {
    expect(filterDates({ ...initialFilters("todo"), preset: "today" }, "2026-10", vnMidnight)).toEqual({ from: "2026-10-11", to: "2026-10-11" });
  });
  it("uses Vietnam yesterday and a Monday week", () => {
    expect(filterDates({ ...initialFilters("todo"), preset: "yesterday" }, "2026-10", vnMidnight).from).toBe("2026-10-10");
    expect(filterDates({ ...initialFilters("todo"), preset: "this_week" }, "2026-10", vnMidnight).from).toBe("2026-10-05");
  });
  it("includes the entire last date with an exclusive end", () => {
    const p = new URLSearchParams(filterParams({ ...initialFilters("todo"), preset: "custom", from: "2026-10-01", to: "2026-10-31" }, "2026-10"));
    expect(p.get("from")).toBe("2026-09-30T17:00:00.000Z");
    expect(p.get("to")).toBe("2026-10-31T17:00:00.000Z");
  });
  it("handles leap years and year boundaries", () => {
    expect(filterDates(initialFilters("run"), "2024-02").to).toBe("2024-02-29");
    expect(filterDates({ ...initialFilters("todo"), preset: "last_month" }, "2026-01", new Date("2026-01-02T03:00:00Z")).from).toBe("2025-12-01");
  });
  it.each([{ from: "", to: "2026-10-02" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "2026-10-03", to: "2026-10-02" }])("blocks incomplete, impossible or reversed dates %o", (range) => {
    expect(() => filterDates({ ...initialFilters("todo"), preset: "custom", ...range }, "2026-10")).toThrow();
  });
  it("does not constrain To-do to the KPI month by default", () => {
    expect(new URLSearchParams(filterParams(initialFilters("todo"), "2026-10")).has("from")).toBe(false);
  });
  it("rejects filters that do not apply to a record", () => {
    expect(filteredPageSchema.safeParse({ kind: "run", dateField: "created" }).success).toBe(false);
    expect(filteredPageSchema.safeParse({ kind: "todo", quality: "met" }).success).toBe(false);
    expect(filteredPageSchema.safeParse({ kind: "todo", category: "SQL" }).success).toBe(false);
  });
  it("requires a complete cursor and valid timestamp window", () => {
    expect(filteredPageSchema.safeParse({ kind: "todo", cursorId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
    expect(filteredPageSchema.safeParse({ kind: "todo", from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }).success).toBe(false);
  });
  it("combines configuration status, owner, scope and effective dates", () => {
    const item = { title: "Vệ sinh", status: "approved", assignee_id: "manager", frequency: "daily", scope: "common", effective_from: "2026-10-01" };
    const f = { ...initialFilters("settings"), state: "approved", assignee: "manager", scope: "common", frequency: "daily", preset: "period" as const };
    expect(matchesConfiguration(item, f, "vệ", "2026-10")).toBe(true);
    expect(matchesConfiguration(item, { ...f, state: "draft" }, "vệ", "2026-10")).toBe(false);
  });
});
