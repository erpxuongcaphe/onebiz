import { beforeEach, describe, expect, it, vi } from "vitest";

function createChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {} as Record<string, ReturnType<typeof vi.fn>>;
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.or = vi.fn(self);
  chain.order = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  return chain;
}

const chain = createChain();
const from = vi.fn(() => chain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from }),
  getCurrentContext: vi.fn().mockResolvedValue({
    tenantId: "tenant-current",
    userId: "user-current",
  }),
  handleError: (error: { message: string }) => {
    throw new Error(error.message);
  },
}));

import {
  deleteSavedView,
  getSavedViews,
  updateSavedView,
} from "@/lib/services/supabase/customer-saved-views";

describe("customer saved views scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns own and shared views only from the active tenant", async () => {
    await getSavedViews();

    expect(from).toHaveBeenCalledWith("customer_saved_views");
    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
    expect(chain.or).toHaveBeenCalledWith("user_id.eq.user-current,is_shared.eq.true");
  });

  it.each([
    ["update", () => updateSavedView("view-1", { name: "VIP" })],
    ["delete", () => deleteSavedView("view-1")],
  ])("%s only targets the active user's view", async (_name, run) => {
    await run();

    expect(chain.eq).toHaveBeenCalledWith("tenant_id", "tenant-current");
    expect(chain.eq).toHaveBeenCalledWith("user_id", "user-current");
    expect(chain.eq).toHaveBeenCalledWith("id", "view-1");
  });
});
