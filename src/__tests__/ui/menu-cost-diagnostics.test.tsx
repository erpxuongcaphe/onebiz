import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuCostDiagnostics } from "@/components/shared/menu-cost-diagnostics";
import { menuCostIssuesText } from "@/lib/reports/menu-cost-diagnostics";

describe("menu component cost diagnostics", () => {
  it("does not render an empty or inferred warning", () => {
    const { container } = render(<MenuCostDiagnostics issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps details compact and exposes component evidence on demand", () => {
    const { container } = render(<MenuCostDiagnostics issues={[{
      componentId: "test", code: "BTP-TEST", name: "Test component", unit: "G",
      reason: "negative_stock", physicalQuantity: -100, costedQuantity: 0,
    }]} />);
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("1 thành phần cần đối soát")).toBeInTheDocument();
    expect(screen.getByText("BTP-TEST · Test component")).toBeInTheDocument();
    expect(screen.getByText("Âm tồn")).toBeInTheDocument();
    fireEvent.click(container.querySelector("summary")!);
    expect(screen.queryByRole("button", { name: /chốt|sửa|khôi phục/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Có giá vốn: 0/)).toBeInTheDocument();
  });

  it("uses the same labels in report exports and does not toggle the parent row", () => {
    let rowClicks = 0;
    const issue = { componentId: "test", code: "TEST", name: "Test", unit: "G", reason: "quantity_mismatch" as const, physicalQuantity: 8, costedQuantity: 5 };
    render(<div onClick={() => rowClicks++}><MenuCostDiagnostics issues={[issue]} /></div>);
    fireEvent.click(screen.getByText("1 thành phần cần đối soát"));
    expect(rowClicks).toBe(0);
    expect(menuCostIssuesText([issue])).toBe("TEST · Test: Lệch lượng giá vốn");
    expect(menuCostIssuesText()).toBe("");
  });
});
