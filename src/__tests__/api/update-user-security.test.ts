import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  permissionAllowed: true,
  targetTenantId: "tenant-1",
  profileUpdateEq: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/permissions/server", () => ({
  hasEffectivePermission: vi.fn(async () => state.permissionAllowed),
}));

vi.mock("@/lib/admin/managed-user-scope", () => ({
  validateManagedUserScope: vi.fn(async (
    _admin: unknown,
    _tenantId: string,
    input: { roleId?: string | null; branchIds?: string[] },
  ) => ({
    roleId: input.roleId,
    branchIds: input.branchIds ?? [],
  })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "manager-1" } },
        error: null,
      })),
    },
    rpc: state.rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: {
              role: "staff",
              role_id: "manager-role",
              tenant_id: "tenant-1",
            },
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        updateUserById: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table: string) => {
      if (table !== "profiles") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: "staff-1",
                tenant_id: state.targetTenantId,
                role: "staff",
                branch_id: "branch-1",
              },
              error: null,
            })),
          })),
        })),
        update: vi.fn(() => ({ eq: state.profileUpdateEq })),
      };
    }),
  })),
}));

function request(body: Record<string, unknown>) {
  return new NextRequest("https://onebiz.com.vn/api/admin/update-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "staff-1", ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.permissionAllowed = true;
  state.targetTenantId = "tenant-1";
  state.profileUpdateEq.mockResolvedValue({ data: {}, error: null });
  state.rpc.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/admin/update-user security", () => {
  it("uses effective permissions and fails closed after a revoke", async () => {
    state.permissionAllowed = false;
    const { POST } = await import("@/app/api/admin/update-user/route");

    const response = await POST(request({ isActive: false }));

    expect(response.status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("blocks a target user from another tenant", async () => {
    state.targetTenantId = "tenant-2";
    const { POST } = await import("@/app/api/admin/update-user/route");

    const response = await POST(request({ isActive: false }));

    expect(response.status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("updates a same-tenant user through the server route", async () => {
    const { POST } = await import("@/app/api/admin/update-user/route");

    const response = await POST(request({ roleId: "role-2" }));

    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("update_managed_user_atomic", {
      p_target_user_id: "staff-1",
      p_profile_patch: { role_id: "role-2" },
      p_branch_ids: null,
    });
  });
});
