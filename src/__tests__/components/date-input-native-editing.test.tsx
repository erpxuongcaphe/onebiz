import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Input } from "@/components/ui/input";

afterEach(cleanup);

it("does not assign a controlled value back over the browser's current date editing buffer", () => {
  const view = render(<Input aria-label="Ngày" type="date" value="2026-10-15" onChange={() => {}} />);
  const input = screen.getByLabelText("Ngày") as HTMLInputElement;
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
  const assign = vi.fn((value: string) => native.set!.call(input, value));
  Object.defineProperty(input, "value", { configurable: true, get: () => native.get!.call(input), set: assign });
  native.set!.call(input, "2026-10-16");
  view.rerender(<Input aria-label="Ngày" type="date" value="2026-10-16" onChange={() => {}} />);
  expect(assign).not.toHaveBeenCalled();
  view.rerender(<Input aria-label="Ngày" type="date" value="2026-11-01" onChange={() => {}} />);
  expect(input.value).toBe("2026-11-01");
  expect(assign).toHaveBeenCalledTimes(1);
});

it("retains ISO change values, external clearing and the native calendar", () => {
  function Form() {
    const [value, setValue] = useState("2026-10-15");
    return <><Input type="date" aria-label="HSD" value={value} onChange={event => setValue(event.target.value)} /><output>{value}</output><button onClick={() => setValue("")}>Xóa</button></>;
  }
  render(<Form />);
  const input = screen.getByLabelText("HSD") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "2026-10-20" } });
  expect(screen.getByText("2026-10-20")).toBeTruthy();
  expect(input.type).toBe("date");
  fireEvent.click(screen.getByText("Xóa"));
  expect(input.value).toBe("");
});

it("supports hours, minute step and native min/max validation without changing saved date values", () => {
  const ref = React.createRef<HTMLInputElement>();
  render(<Input ref={ref} aria-label="Hạn dùng" type="datetime-local" value="2026-10-15T17:30" min="2026-10-15T08:00" max="2026-10-16T08:00" step={60} onChange={() => {}} />);
  expect(ref.current?.value).toBe("2026-10-15T17:30");
  expect(ref.current?.checkValidity()).toBe(true);
  expect(ref.current?.title).toContain("HH:mm");
});
