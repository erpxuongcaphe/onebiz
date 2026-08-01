import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { hasEffectivePermission } from "@/lib/permissions/server";
import type { Database } from "@/lib/supabase/types";

function clientWithRpc(
  result: { data: Array<{ permission_code: string }> | null; error: unknown },
) {
  return {
    rpc: vi.fn(async () => result),
  } as unknown as SupabaseClient<Database>;
}

describe("hasEffectivePermission", () => {
  it("accepts a permission present in the effective permission result", async () => {
    const client = clientWithRpc({
      data: [{ permission_code: "system.manage_users" }],
      error: null,
    });

    await expect(
      hasEffectivePermission(client, "user-1", ["system.manage_users"]),
    ).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("get_user_effective_permissions", {
      p_user_id: "user-1",
    });
  });

  it("denies missing or revoked permissions", async () => {
    const client = clientWithRpc({
      data: [{ permission_code: "reports.view" }],
      error: null,
    });

    await expect(
      hasEffectivePermission(client, "user-1", ["system.manage_users"]),
    ).resolves.toBe(false);
  });

  it("fails closed when the permission RPC fails", async () => {
    const client = clientWithRpc({
      data: null,
      error: { message: "rpc failed" },
    });

    await expect(
      hasEffectivePermission(client, "user-1", ["system.manage_users"]),
    ).resolves.toBe(false);
  });
});
