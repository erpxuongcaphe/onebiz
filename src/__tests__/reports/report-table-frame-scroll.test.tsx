import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReportTableFrame } from "@/components/shared/report/report-table-frame";

afterEach(cleanup);

describe("legacy report frame scrolling", () => {
  it("uses the shared viewport and removes nested scroll containers", () => {
    const { container } = render(<ReportTableFrame tablePreferenceKey="test.frame.scroll">
      <div className="overflow-x-auto"><table><thead><tr><th>Mã</th><th>Số lượng</th></tr></thead><tbody><tr><td>SKU-001</td><td>7</td></tr></tbody></table></div>
    </ReportTableFrame>);
    expect(screen.getByRole("region", { name: "Bảng số liệu báo cáo" })).toBeTruthy();
    const css = container.querySelector("style")?.textContent;
    expect(css).toContain("overflow:visible!important;max-height:none!important");
    expect(css).toContain("thead{position:sticky;top:0");
    expect(screen.getByText("SKU-001")).toBeTruthy();
  });
  it("does not pin merged subtotal cells across the entire table", async () => {
    const { container } = render(<ReportTableFrame tablePreferenceKey="test.frame.merged">
      <table><thead><tr><th>Mã</th><th>Số lượng</th></tr></thead><tbody><tr><td colSpan={2}>Tổng cộng</td></tr></tbody></table>
    </ReportTableFrame>);
    await waitFor(() => expect(container.querySelector("style")?.textContent).not.toContain("left:0"));
  });
});
