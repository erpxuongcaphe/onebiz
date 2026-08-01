import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ rpc }),
  getCurrentTenantId: vi.fn().mockResolvedValue("tenant-1"),
  handleError: (error: { message: string }, context: string) => {
    throw new Error(`[${context}] ${error.message}`);
  },
}));

import {
  assignRoleToUser,
  createRole,
  deleteRole,
  setRolePermissions,
} from "@/lib/services/supabase/roles";

const migration = readFileSync(
  "supabase/migrations/00282_atomic_role_management.sql",
  "utf8",
);
const service = readFileSync("src/lib/services/supabase/roles.ts", "utf8");
const page = readFileSync(
  "src/app/(main)/cai-dat/phan-quyen/page.tsx",
  "utf8",
);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: {
      id: "role-1",
      tenant_id: "tenant-1",
      name: "MKT cộng tác",
      description: null,
      color: "bg-primary",
      is_system: false,
      created_at: "2026-07-31T00:00:00Z",
    },
    error: null,
  });
});

describe("atomic role management", () => {
  it("creates a role and initial permissions in one RPC", async () => {
    const role = await createRole({
      tenantId: "tenant-1",
      name: "MKT cộng tác",
      permissions: ["mkt.view", "mkt.review_content"],
    });
    expect(role.id).toBe("role-1");
    expect(rpc).toHaveBeenCalledWith("save_role_atomic", {
      p_role_id: null,
      p_payload: {
        name: "MKT cộng tác",
        description: null,
        color: "bg-primary",
      },
      p_permission_codes: ["mkt.view", "mkt.review_content"],
    });
  });

  it("replaces permissions and deletes roles through guarded transactions", async () => {
    await setRolePermissions("role-1", ["mkt.view", "mkt.view"]);
    expect(rpc).toHaveBeenCalledWith("save_role_atomic", {
      p_role_id: "role-1",
      p_payload: {},
      p_permission_codes: ["mkt.view"],
    });
    await deleteRole("role-1");
    expect(rpc).toHaveBeenCalledWith("delete_role_atomic", { p_role_id: "role-1" });
  });

  it("assigns a role through the managed-user authorization path", async () => {
    await assignRoleToUser("user-1", "role-1");
    expect(rpc).toHaveBeenCalledWith("update_managed_user_atomic", {
      p_target_user_id: "user-1",
      p_profile_patch: { role_id: "role-1" },
      p_branch_ids: null,
    });
  });

  it("uses effective permission, tenant locks, validation and atomic audit", () => {
    expect(migration).toContain("system.manage_roles");
    expect(migration).toContain("public.user_has_permission");
    expect(migration).toContain("for update");
    expect(migration).toContain("SYSTEM_ROLE_CANNOT_DELETE");
    expect(migration).toContain("PERMISSION_CODES_INVALID");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'atomic', true");
    expect(page).toContain("PERMISSIONS.SYSTEM_MANAGE_ROLES");
    expect(service).not.toContain("recordAuditLog");
  });
});
