import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ApprovalsPage from "@/app/mkt/approvals/page";

const mocks = vi.hoisted(() => ({
  reviewable: vi.fn().mockResolvedValue(["a"]),
  items: ["a", "b"].map((id) => ({
    id, title: `Nội dung ${id}`, campaignName: null, contentStatus: "pending_review",
    riskLevel: "low", currentVersion: 1, revisionCount: 0, latestUrl: null,
    latestNote: null, versions: [], reviews: [],
  })),
}));
vi.mock("@/lib/mkt/request-context", () => ({
  getMktRequestContext: async () => ({ supabase: {}, ctx: { canReview: true, canOverride: false } }),
}));
vi.mock("@/lib/mkt/read-models", () => ({
  getApprovals: async () => mocks.items,
  getMktReviewableContentIds: mocks.reviewable,
}));
vi.mock("@/components/mkt/review-actions", () => ({
  ReviewActions: ({ contentId }: { contentId: string }) => <button>Duyệt {contentId}</button>,
}));

describe("approval actions by branch", () => {
  it("keeps assigned content visible but offers review only for permitted content", async () => {
    render(await ApprovalsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Duyệt a" })).toBeVisible();
    const other = screen.getByText("Nội dung b").closest("article");
    expect(other).not.toBeNull();
    expect(within(other!).queryByRole("button", { name: "Duyệt b" })).toBeNull();
    expect(within(other!).getByText(/không có quyền duyệt tại chi nhánh/)).toBeVisible();
    expect(mocks.reviewable).toHaveBeenCalledWith(expect.anything(), ["a", "b"]);
  });
});
