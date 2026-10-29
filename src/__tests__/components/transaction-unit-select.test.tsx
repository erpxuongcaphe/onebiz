import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransactionUnitSelect } from "@/components/shared/transaction-unit-select";
import type { UOMConversion } from "@/lib/types";
const conversions = [{ fromUnit: "Thùng", toUnit: "Lon", factor: 12, isActive: true }, { fromUnit: "Lon", toUnit: "G", factor: 1000, isActive: true }, { fromUnit: "Hộp cũ", toUnit: "Lon", factor: 3, isActive: false }] as UOMConversion[];
describe("transaction unit choice", () => {
  it("uses configured units and a price ratio for the newly chosen transaction unit", () => {
    const change = vi.fn();
    render(<TransactionUnitSelect value="Lon" stockUnit="Lon" conversions={conversions} quantity={1} label="Đơn vị sữa" onChange={change} />);
    expect(screen.getAllByRole("option").map(el => el.textContent)).toEqual(["Lon", "Thùng", "G"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Thùng" } });
    expect(change).toHaveBeenCalledWith("Thùng", 12);
  });
  it("shows the stock quantity of the entered units without changing the input", () => {
    render(<TransactionUnitSelect value="Thùng" stockUnit="Lon" conversions={conversions} quantity={2} label="Đơn vị sữa" onChange={vi.fn()} />);
    expect(screen.getByText("= 24 Lon")).toBeVisible();
  });
  it("does not silently replace historical units that are no longer configured", () => {
    render(<TransactionUnitSelect value="Hộp cũ" stockUnit="Lon" conversions={conversions} quantity={1} label="Đơn vị sữa" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveValue("Hộp cũ");
    expect(screen.getByRole("alert")).toHaveTextContent("Kiểm tra quy đổi");
  });
});
