import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NumericInput } from "@/components/ui/numeric-input";
afterEach(cleanup);
it("keeps four-decimal quantities through focus, entry and blur", () => {
  const change = vi.fn();
  render(<NumericInput aria-label="Số lượng" value={0.0042} decimals={4} min={0.0001} onChange={change} />);
  const field = screen.getByRole("textbox", { name: "Số lượng" });
  expect(field).toHaveValue("0.0042");
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "1,234.0042" } });
  fireEvent.blur(field);
  expect(change).toHaveBeenLastCalledWith(1234.0042);
  expect(field).toHaveValue("1,234.0042");
});
it("keeps money's declared two-decimal precision separate", () => {
  const change = vi.fn();
  render(<NumericInput aria-label="Số tiền" value={1234.56789} decimals={2} onChange={change} />);
  expect(screen.getByRole("textbox", { name: "Số tiền" })).toHaveValue("1,234.57");
  expect(change).not.toHaveBeenCalled();
});
