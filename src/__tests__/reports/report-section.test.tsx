import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportSection } from "@/components/shared/report/report-section";
afterEach(cleanup);
describe("report section hierarchy", () => {
  it("exposes a named section with heading, contextual text and actions", () => {
    render(<ReportSection title="Kết quả vận hành" subtitle="Kỳ tháng 10" tone="primary" actions={<button>Chi tiết</button>}><table><tbody><tr><td>125,000</td></tr></tbody></table></ReportSection>);
    expect(screen.getByRole("region", { name: "Kết quả vận hành" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kết quả vận hành", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Kỳ tháng 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chi tiết" })).toBeInTheDocument();
    expect(screen.getByText("125,000")).toBeInTheDocument();
  });
  it("keeps sections unframed and uses a wrapping title band", () => {
    render(<ReportSection title="Đối chiếu chi nhánh" tone="review">Nội dung</ReportSection>);
    const section = screen.getByRole("region", { name: "Đối chiếu chi nhánh" });
    expect(section.className).not.toMatch(/rounded|shadow/);
    expect(section.querySelector("header")?.className).toContain("flex-wrap");
    expect(section.querySelector("header")?.className).toContain("border-status-warning");
  });
});
