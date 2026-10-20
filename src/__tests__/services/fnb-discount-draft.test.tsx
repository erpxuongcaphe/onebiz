import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiscountRow } from "@/app/pos/fnb/components/fnb-cart";
afterEach(cleanup);
describe("manual discount is staged before requesting approval", () => {
  it("does not request OTP while typing or leaving the field; submits the completed amount once", () => {
    const submit = vi.fn(); render(<DiscountRow discount={undefined} onChange={submit} />);
    const input = screen.getByRole("textbox", { name: "Giá trị giảm giá" });
    for (const value of ["5", "50", "500", "5.000", "50.000"]) fireEvent.change(input, { target: { value } });
    fireEvent.blur(input); expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng giảm giá" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith({ mode: "amount", value: 50000 });
  });
  it("selects percent before entering a value and submits it only on apply", () => {
    const submit = vi.fn(); render(<DiscountRow discount={undefined} onChange={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Giảm giá theo phần trăm" }));
    expect(screen.getByRole("button", { name: "Giảm giá theo phần trăm" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "12,5" } });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Áp dụng giảm giá" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith({ mode: "percent", value: 12.5 });
  });
  it("rejects percentages over 100 and preserves the approved discount until explicitly removed", () => {
    const submit = vi.fn(); render(<DiscountRow discount={{ mode: "percent", value: 10 }} onChange={submit} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "150" } });
    expect(screen.getByRole("alert")).toHaveTextContent("0 đến 100%");
    expect(screen.getByRole("button", { name: "Áp dụng giảm giá" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Bỏ giảm giá" }));
    expect(submit).toHaveBeenCalledExactlyOnceWith(undefined);
  });
  it("stages a preset without opening approval until Enter", () => {
    const submit = vi.fn(); render(<DiscountRow discount={undefined} onChange={submit} presets={[{ id: "d", name: "Ưu đãi 20%", mode: "percent", value: 20 }]} />);
    fireEvent.click(screen.getByTitle("Khuyến mãi nhanh"));
    fireEvent.click(screen.getByRole("button", { name: /Ưu đãi 20%/ }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(submit).toHaveBeenCalledExactlyOnceWith({ mode: "percent", value: 20 });
  });
});
