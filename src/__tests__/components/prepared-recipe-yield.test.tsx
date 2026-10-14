import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedRecipeYield } from "@/components/shared/prepared-recipe-yield";

afterEach(cleanup);
describe("prepared recipe yield", () => {
  it("requires an explicit yield and explains that ingredients are for the whole batch", () => {
    const onChange = vi.fn();
    render(<PreparedRecipeYield value="" unit="G" onChange={onChange} />);
    const input = screen.getByRole("spinbutton", { name: /1 mẻ thu được/ });
    expect(input).toHaveValue(null);
    expect(screen.getByText(/nguyên liệu nhập theo mẻ/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "1650" } });
    expect(onChange).toHaveBeenCalledWith("1650");
  });
  it("previews the measured output without suggesting an automatic water conversion", () => {
    render(<PreparedRecipeYield value="1650" unit="G" onChange={vi.fn()} />);
    expect(screen.getByRole("spinbutton")).toHaveValue(1650);
    expect(screen.getByText("G")).toBeInTheDocument();
  });
  it("shows an accessible validation error without replacing entered quantity", () => {
    render(<PreparedRecipeYield value="0" unit="G" onChange={vi.fn()} error="Nhập sản lượng lớn hơn 0." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Nhập sản lượng lớn hơn 0.");
    expect(screen.getByRole("spinbutton")).toHaveValue(0);
    expect(screen.queryByText(/dự kiến nhập/)).not.toBeInTheDocument();
  });
});
