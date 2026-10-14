import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreparedRecipePerUnit } from "@/components/shared/prepared-recipe-per-unit";
afterEach(cleanup);
describe("prepared recipe comparison", () => {
  it("recalculates after yield and ingredient quantity change", () => {
    const { rerender } = render(<PreparedRecipePerUnit quantity={100} yieldQty={750} unit="G" />);
    expect(screen.getByText("0.1333 G")).toBeInTheDocument();
    rerender(<PreparedRecipePerUnit quantity={100} yieldQty={1000} unit="G" />);
    expect(screen.getByText("0.1 G")).toBeInTheDocument();
    rerender(<PreparedRecipePerUnit quantity={200} yieldQty={1000} unit="G" />);
    expect(screen.getByText("0.2 G")).toBeInTheDocument();
  });
  it("keeps fractional packages visible rather than rounding to zero", () => {
    render(<PreparedRecipePerUnit quantity={1} yieldQty={1100} unit="Túi" />);
    expect(screen.getByText("0.0009 Túi")).toBeInTheDocument();
  });
  it("does not divide by an empty or invalid yield", () => {
    const { rerender } = render(<PreparedRecipePerUnit quantity={1000} yieldQty={0} unit="G" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<PreparedRecipePerUnit quantity={1000} yieldQty={NaN} unit="G" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
