import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { canManageAccount } from "@/lib/admin/account-management-authorization";

describe("account-management server authorization", () => {
  it.each([null, false, "true", {}, []])("fails closed for malformed/denied response %j", async data => {
    const client = { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
    expect(await canManageAccount(client as unknown as SupabaseClient<Database>, "target", "password")).toBe(false);
  });
  it("does not allow an RPC error even when it includes truthy data", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: true, error: { message: "unavailable" } }) };
    expect(await canManageAccount(client as unknown as SupabaseClient<Database>, "target", "edit")).toBe(false);
  });
  it("sends the complete proposed assignment to the caller-scoped RPC", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    expect(await canManageAccount(client as unknown as SupabaseClient<Database>, "target", "edit", "role", ["branch"])).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith("check_account_management_scope", {
      p_target: "target", p_action: "edit", p_role: "role", p_branches: ["branch"],
      p_position: null,
      p_department: null,
    });
  });
});
