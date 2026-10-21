import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => mocks, getCurrentTenantId: vi.fn(), handleError: (error: { message: string }) => { throw new Error(error.message); } }));
import { getUserPermissions } from "@/lib/services/supabase/roles";
beforeEach(() => vi.clearAllMocks());
describe("strict role-permission read for user editor", () => {
  it("propagates a failed read instead of displaying an empty role", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "Test read failed" } });
    await expect(getUserPermissions("test-user", { strict: true })).rejects.toThrow("Test read failed");
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("returns the role source unchanged on a successful read", async () => {
    mocks.rpc.mockResolvedValue({ data: ["test.sales", "test.stock"], error: null });
    expect(await getUserPermissions("test-user", { strict: true })).toEqual(new Set(["test.sales", "test.stock"]));
    expect(mocks.rpc).toHaveBeenCalledWith("get_user_permissions", { p_user_id: "test-user" });
  });
});
