import { expect, it } from "vitest";
import { operatingResultAvailable } from "@/lib/reports/operating-result-availability";
it("requires both cost and expense coverage for operating results", () => {
  expect(operatingResultAvailable({ cogsComplete: true, operatingExpenseComplete: false })).toBe(false);
  expect(operatingResultAvailable({ cogsComplete: false, operatingExpenseComplete: true })).toBe(false);
  expect(operatingResultAvailable({ cogsComplete: true, operatingExpenseComplete: true })).toBe(true);
});
