import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { validateManagedUserScope } from "@/lib/admin/managed-user-scope";
import type { Database } from "@/lib/supabase/types";

function makeClient(options?: {
  roleExists?: boolean;
  branchIds?: string[];
}) {
  const roleExists = options?.roleExists ?? true;
  const branchIds = options?.branchIds ?? ["branch-1"];
  return {
    from: vi.fn((table: string) => {
      if (table === "roles") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: roleExists ? { id: "role-1" } : null,
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === "branches") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({
                data: branchIds.map((id) => ({ id })),
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("validateManagedUserScope", () => {
  it("normalizes duplicate branch ids after tenant validation", async () => {
    const result = await validateManagedUserScope(makeClient(), "tenant-1", {
      roleId: null,
      branchIds: ["branch-1", "branch-1"],
      allBranches: false,
      requireBranchSelection: true,
    });

    expect(result).toEqual({
      roleId: null,
      branchIds: ["branch-1"],
    });
  });

  it("rejects a role outside the tenant", async () => {
    const result = await validateManagedUserScope(
      makeClient({ roleExists: false }),
      "tenant-1",
      {
        roleId: "role-1",
        branchIds: ["branch-1"],
        allBranches: false,
        requireBranchSelection: true,
      },
    );

    expect(result.error).toContain("Vai trò");
  });

  it("rejects a branch outside the tenant", async () => {
    const result = await validateManagedUserScope(
      makeClient({ branchIds: [] }),
      "tenant-1",
      {
        roleId: null,
        branchIds: ["branch-1"],
        allBranches: false,
        requireBranchSelection: true,
      },
    );

    expect(result.error).toContain("chi nhánh");
  });

  it("requires an explicit branch selection when requested", async () => {
    const result = await validateManagedUserScope(makeClient(), "tenant-1", {
      roleId: null,
      branchIds: [],
      allBranches: false,
      requireBranchSelection: true,
    });

    expect(result.error).toContain("Chọn ít nhất");
  });
});
