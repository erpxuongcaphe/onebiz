import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import AuditPage from "@/app/(main)/he-thong/audit/page";

const mocks = vi.hoisted(() => ({ history: vi.fn(), toast: vi.fn(), branch: "b1", people: [] }));
vi.mock("@/lib/contexts", () => ({
  useToast: () => ({ toast: mocks.toast }),
  useBranchFilter: () => ({ activeBranchId: mocks.branch, branchLabel: mocks.branch, branches: [], isReady: true }),
}));
vi.mock("@/lib/services/supabase/audit", () => ({
  getOperationHistory: mocks.history,
  getProfilesForPersonFilter: async () => mocks.people,
  getActionOptions: () => [], getEntityTypeOptions: () => [], localizeAuditData: (v: unknown) => v,
}));
vi.mock("@/components/shared/permission-page", () => ({ PermissionPage: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/shared/list-page-layout", () => ({ ListPageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/shared/page-header", () => ({ PageHeader: () => <h1>Lịch sử thao tác</h1> }));
// Keep the page's request lifecycle real; replace only the shared table layout.
vi.mock("@/components/shared/data-table", () => ({ DataTable: ({ data, loading, total }: { data: { entityName: string }[]; loading: boolean; total: number }) => <section aria-label="Nhật ký">{loading ? "Đang tải" : <><p>{total} bản ghi</p>{data.map((r, i) => <p key={i}>{r.entityName}</p>)}</>}</section> }));
beforeEach(() => {
  mocks.history.mockReset(); mocks.toast.mockReset(); mocks.branch = "b1";
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});
describe("operation history page results", () => {
  it("uses the current branch and shows an explicit error with retry", async () => {
    mocks.history.mockRejectedValueOnce(new Error("Không đủ quyền xem chi nhánh"));
    render(<AuditPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa tải được nhật ký");
    expect(screen.queryByText("0 bản ghi")).not.toBeInTheDocument();
    expect(mocks.history).toHaveBeenCalledWith(expect.objectContaining({ filters: expect.objectContaining({ branchId: "b1" }) }));
    mocks.history.mockResolvedValueOnce({ total: 1, data: [{ entityName: "KB000010" }] });
    fireEvent.click(screen.getByRole("button", { name: "Tải lại" }));
    expect(await screen.findByText("KB000010")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not replace the selected branch history with a late response from the previous branch", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    mocks.history.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }));
    mocks.history.mockResolvedValue({ total: 1, data: [{ entityName: "Bill chi nhánh b2" }] });
    const { rerender } = render(<AuditPage />);
    await waitFor(() => expect(mocks.history).toHaveBeenCalledOnce());
    mocks.branch = "b2";
    rerender(<AuditPage />);
    expect(await screen.findByText("Bill chi nhánh b2")).toBeInTheDocument();
    await act(async () => { resolveFirst({ total: 99, data: [{ entityName: "Bill cũ b1" }] }); });
    expect(screen.queryByText("Bill cũ b1")).not.toBeInTheDocument();
    expect(screen.getByText("1 bản ghi")).toBeInTheDocument();
  });
});
