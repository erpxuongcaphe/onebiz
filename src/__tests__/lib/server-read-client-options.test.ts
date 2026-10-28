import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), set: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: mocks.set }), headers: async () => new Headers({ host: "fnb.onebiz.com.vn" }) }));
import { createServerSupabaseClient } from "@/lib/supabase/server";
afterEach(() => vi.clearAllMocks());
describe("request-local server transport options", () => {
  it("uses a custom fetch only for the requesting read and keeps the default client unchanged", async () => {
    const custom: typeof fetch = vi.fn();
    await createServerSupabaseClient({ fetch: custom }); await createServerSupabaseClient();
    expect(mocks.create.mock.calls[0][2].global.fetch).toBe(custom);
    expect(mocks.create.mock.calls[1][2]).not.toHaveProperty("global");
  });
  it("preserves shared subdomain cookie handling when the read client refreshes a session", async () => {
    await createServerSupabaseClient({ fetch: vi.fn() });
    mocks.create.mock.calls[0][2].cookies.setAll([{ name: "session", value: "test-only", options: { httpOnly: true } }]);
    expect(mocks.set).toHaveBeenCalledWith("session", "test-only", expect.objectContaining({ domain: ".onebiz.com.vn", httpOnly: true }));
  });
});
