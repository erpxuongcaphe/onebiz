import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CampaignFormDialog } from "@/components/mkt/campaign-form-dialog";

const mocks = vi.hoisted(() => ({ post: vi.fn().mockResolvedValue({ success: true, campaignId: "new" }), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/mkt/client", () => ({ mktPost: mocks.post }));
vi.mock("@/components/mkt/mkt-routing", () => ({ useMktHref: () => (path: string) => path }));
vi.mock("@/lib/mkt/use-mkt-refresh", () => ({ useMktRefresh: () => ({ refresh: vi.fn(), refreshing: false }) }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: () => null,
}));

describe("campaign creation scope", () => {
  it("submits the selected permitted branch without offering shared scope", async () => {
    render(<CampaignFormDialog branches={[{ id: "a", name: "Quán A" }, { id: "b", name: "Quán B" }]} canCreateShared={false} />);
    expect(screen.queryByText("Dùng chung toàn công ty")).toBeNull();
    fireEvent.change(screen.getByLabelText("Phạm vi chiến dịch"), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Tên chiến dịch"), { target: { value: "Chiến dịch thử" } });
    fireEvent.click(screen.getByRole("button", { name: /Tạo chiến dịch/i }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/api/mkt/v1/campaigns", expect.objectContaining({ branchId: "b" })));
  });
});
