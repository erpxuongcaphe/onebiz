import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReportCenterPage from "@/app/(main)/phan-tich/trung-tam/page";

vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("@/lib/reports/preferences", () => ({
  readFavoriteReportPaths: () => [], readRecentReportPaths: () => [],
  toggleFavoriteReportPath: (path: string) => [path],
}));
afterEach(cleanup);

describe("report center navigation", () => {
  it("narrows the report list by category without removing navigation", () => {
    render(<ReportCenterPage />);
    fireEvent.click(screen.getByRole("button", { name: /Hàng hóa & tồn kho/ }));
    expect(screen.getByRole("link", { name: /Xuất.*Nhập.*Tồn/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Báo cáo cuối ngày/i })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Nhóm báo cáo" })).toBeTruthy();
  });
  it("searches reports and offers a clear-search action", () => {
    render(<ReportCenterPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm báo cáo" }), { target: { value: "zzzz-no-report" } });
    expect(screen.getByText("Không tìm thấy báo cáo phù hợp")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xóa tìm kiếm" }));
    expect(screen.queryByText("Không tìm thấy báo cáo phù hợp")).toBeNull();
  });
});
