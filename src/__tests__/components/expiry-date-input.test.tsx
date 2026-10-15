import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ExpiryDateInput } from "@/components/shared/expiry-date-input";
import { expiryToIso, formatExpiryDate, isExpiryPast } from "@/lib/expiry-time";

afterEach(cleanup);

it("keeps date-only expiry until an hour is entered, and clearing the day clears the hour", () => {
  function Form() {
    const [value, setValue] = useState("2026-10-15");
    return <><ExpiryDateInput value={value} onValueChange={setValue} /><output data-testid="value">{value}</output></>;
  }
  render(<Form />);
  const day = screen.getByLabelText("Hạn sử dụng") as HTMLInputElement;
  const hour = screen.getByLabelText("Hạn sử dụng — giờ") as HTMLInputElement;
  expect(hour.value).toBe("");
  fireEvent.change(hour, { target: { value: "17:30" } });
  expect(screen.getByTestId("value").textContent).toBe("2026-10-15T17:30");
  fireEvent.change(day, { target: { value: "" } });
  expect(screen.getByTestId("value").textContent).toBe("");
  expect(hour.disabled).toBe(true);
});

it("uses Vietnam time, preserves legacy dates and distinguishes expired hours within the same day", () => {
  expect(expiryToIso("2026-10-15T17:30")).toBe("2026-10-15T10:30:00.000Z");
  expect(expiryToIso("2026-10-15")).toBe("2026-10-15");
  expect(formatExpiryDate("2026-10-15T10:30:00Z")).toBe("15/10/2026 17:30");
  expect(formatExpiryDate("2026-10-15")).toBe("15/10/2026");
  const now = Date.parse("2026-10-15T11:00:00Z");
  expect(isExpiryPast("2026-10-15T17:30", now)).toBe(true);
  expect(isExpiryPast("2026-10-15", now)).toBe(false);
  expect(() => expiryToIso("2026-02-30")).toThrow();
  expect(() => expiryToIso("2026-10-15T25:30")).toThrow();
});
