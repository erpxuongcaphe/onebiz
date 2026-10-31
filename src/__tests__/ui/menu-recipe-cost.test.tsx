import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuRecipeCost } from "@/components/shared/menu-recipe-cost";

describe("current recipe cost display", () => {
  it("keeps the calculated amount visible independently of stock warnings", () => {
    render(<MenuRecipeCost loading={false} estimate={{ value: 12345.678, variantName: "Size L", issues: [{ componentId: "prepared", code: "BTP-TEST", name: "Test ingredient", unit: "G", reason: "negative_stock", physicalQuantity: -10, costedQuantity: 0 }] }} />);
    expect(screen.getByText("12,345.68")).toBeInTheDocument();
    expect(screen.getByText("Dự toán BOM · Size L")).toBeInTheDocument();
    expect(screen.getByText("1 thành phần cần đối soát")).toBeInTheDocument();
    expect(screen.queryByText(/Chờ đối soát/)).not.toBeInTheDocument();
  });
  it("never displays unknown cost as zero and hides prior diagnostics while loading", () => {
    const { rerender } = render(<MenuRecipeCost loading={false} estimate={{ value: null, reason: "Thiếu đơn giá nguyên liệu" }} />);
    expect(screen.getByText("Thiếu đơn giá nguyên liệu")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    rerender(<MenuRecipeCost loading estimate={{ value: 999 }} />);
    expect(screen.getByText("Đang tính...")).toBeInTheDocument();
    expect(screen.queryByText("999")).not.toBeInTheDocument();
  });
});
