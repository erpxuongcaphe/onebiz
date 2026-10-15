import { expect, it } from "vitest";
import { validateProductionDateTimes } from "@/lib/production-date-time";

it("checks time order on the same day before creating a production order", () => {
  expect(validateProductionDateTimes({ plannedStart: "2030-10-15T10:30", plannedEnd: "2030-10-15T08:30" })).toMatch(/hoàn thành/);
  expect(validateProductionDateTimes({ plannedStart: "2030-10-15T10:30", plannedEnd: "2030-10-15T10:30" })).toBeNull();
});
it("compares dates in Vietnam across UTC midnight", () => {
  expect(validateProductionDateTimes({ manufacturedDate: "2030-10-14T17:15:00Z", expiryDate: "2030-10-15T00:30" })).toBeNull();
  expect(validateProductionDateTimes({ manufacturedDate: "2030-10-15T00:15", expiryDate: "2030-10-14T23:59" })).toMatch(/Hạn sử dụng/);
});
it("keeps optional hours and rejects invalid date/time", () => {
  expect(validateProductionDateTimes({ manufacturedDate: "2030-10-15T10:30", expiryDate: "2030-10-15" })).toBeNull();
  expect(validateProductionDateTimes({ plannedStart: "2030-02-30" })).toMatch(/không hợp lệ/);
});
