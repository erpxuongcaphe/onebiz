import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReportTableViewport } from "@/components/shared/report/report-table-viewport";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("report table viewport", () => {
  it("keeps a bounded vertical viewport and synchronizes both horizontal scrollbars", () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(1800);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
    render(<ReportTableViewport><table><tbody><tr><td>Mã hàng</td></tr></tbody></table></ReportTableViewport>);
    const content = screen.getByRole("region", { name: "Bảng số liệu báo cáo" });
    const bar = screen.getByRole("region", { name: "Cuộn ngang bảng báo cáo" });
    expect(content.className).toContain("max-h-[65dvh]");
    expect(bar.className).toContain("sticky bottom-0");
    expect(bar.style.height).toBe("18px");
    bar.scrollLeft = 320;
    fireEvent.scroll(bar);
    expect(content.scrollLeft).toBe(320);
    content.scrollLeft = 560;
    fireEvent.scroll(content);
    expect(bar.scrollLeft).toBe(560);
  });
  it("hides the extra scrollbar when columns fit", () => {
    render(<ReportTableViewport><table /></ReportTableViewport>);
    const bar = screen.getByLabelText("Cuộn ngang bảng báo cáo");
    expect(bar.style.visibility).toBe("hidden");
    expect(bar.tabIndex).toBe(-1);
  });
});
