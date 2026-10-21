import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ search: vi.fn(), allow: true, branch: { id: "test-branch", name: "Chi nhánh thử có tên dài để kiểm tra bố cục", branchType: "store" }, tenant: { id: "test-tenant" } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/contexts", () => ({ useAuth: () => ({ user: { id: "test-user", fullName: "Test User" }, tenant: mocks.tenant, branches: [mocks.branch], currentBranch: mocks.branch, hasPermission: () => mocks.allow, switchBranch: vi.fn(), logout: vi.fn() }) }));
vi.mock("@/lib/services", () => ({ getUnreadNotificationCount: async () => 0 }));
vi.mock("@/components/shared/command-palette", () => ({ useCommandPalette: () => ({ openPalette: mocks.search }) }));
vi.mock("@/components/shared/app-switcher", () => ({ AppSwitcher: () => <button>Ứng dụng</button> }));
vi.mock("@/components/shared/import-data-dialog", () => ({ ImportDataDialog: () => null }));
vi.mock("@/lib/operations/use-hub-access", () => ({ useHubAccess: () => false }));
vi.mock("@/lib/hooks/use-fnb-subdomain", () => ({ useFnbSubdomain: () => ({ posFnbUrl: () => "/pos/fnb" }) }));
vi.mock("@/lib/services/supabase/fnb-cancel-requests", () => ({ pendingFnbCancellations: async () => [] }));
vi.mock("@/lib/services/supabase/manager-approval", () => ({ pendingManagerApprovals: async () => [] }));
import { TopNav } from "@/components/shared/top-nav";
afterEach(() => { cleanup(); mocks.allow = true; vi.clearAllMocks(); });

describe("responsive top navigation", () => {
  it("keeps compact search accessible and working", () => {
    render(<TopNav />);
    fireEvent.click(screen.getByRole("button", { name: "Tìm sản phẩm, khách hàng, đơn hàng..." }));
    expect(mocks.search).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "POS" })).toHaveAttribute("title", "Chế độ bán hàng");
    expect(screen.getByRole("link", { name: "Cấp OTP" })).toHaveAttribute("href", "/cap-otp");
  });
  it("retains the full branch name and long-name truncation inside a shrinkable selector", () => {
    render(<TopNav />);
    const branch = screen.getAllByText(mocks.branch.name).find(element => element.hasAttribute("title"));
    expect(branch).toHaveAttribute("title", mocks.branch.name);
    expect(branch).toHaveClass("min-w-0", "truncate");
    expect(branch?.closest("button")).toHaveClass("min-w-0");
  });
  it("does not grant POS or approval access when compact controls are used", () => {
    mocks.allow = false;
    render(<TopNav />);
    expect(screen.queryByRole("button", { name: "POS" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cấp OTP" })).not.toBeInTheDocument();
  });
});
