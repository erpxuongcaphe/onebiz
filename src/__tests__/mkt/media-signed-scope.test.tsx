import { describe, expect, it, vi } from "vitest";
import MediaPage from "@/app/mkt/media/page";

const mocks = vi.hoisted(() => ({ sign: vi.fn().mockResolvedValue({ data: [] }) }));
vi.mock("@/lib/mkt/request-context", () => ({
  getMktRequestContext: async () => ({ supabase: {}, ctx: { tenantId: "tenant-a" } }),
}));
vi.mock("@/lib/mkt/read-models", () => ({
  getCampaignList: async () => [],
  // This is the result after the user's RLS-filtered database query.
  getMediaAssets: async () => [
    { id: "allowed", sourceType: "upload", storagePath: "tenant-a/visible.png" },
    { id: "wrong-tenant", sourceType: "upload", storagePath: "tenant-b/wrong.png" },
    { id: "external", sourceType: "drive", storagePath: "tenant-a/external.png" },
  ],
}));
vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({ storage: { from: () => ({ createSignedUrls: mocks.sign }) } }),
}));
vi.mock("@/components/mkt/media-library", () => ({ MediaLibrary: () => null }));

describe("MKT signed media", () => {
  it("only signs uploaded paths returned for the current tenant", async () => {
    await MediaPage();
    expect(mocks.sign).toHaveBeenCalledWith(["tenant-a/visible.png"], 3600);
  });
});
