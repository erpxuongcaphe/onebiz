import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00280_atomic_managed_user_initialize.sql",
  "utf8",
);
const route = readFileSync("src/app/api/admin/create-user/route.ts", "utf8");

describe("atomic managed-user initialization", () => {
  it("checks the real actor, effective permission and target Auth user", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("system.create_user");
    expect(migration).toContain("system.manage_users");
    expect(migration).toContain("from auth.users");
    expect(migration).toContain("CROSS_TENANT_TARGET_DENIED");
  });

  it("validates role and active branches before writing profile scope", () => {
    expect(migration).toContain("ROLE_NOT_FOUND");
    expect(migration).toContain("BRANCH_SCOPE_INVALID");
    expect(migration).toContain("coalesce(b.is_active, true)");
    expect(migration).toContain("delete from public.user_branches");
    expect(migration).toContain("insert into public.user_branches");
    expect(migration).toContain("insert into public.audit_log");
  });

  it("uses one database RPC after Auth creation and keeps cleanup on failure", () => {
    expect(route).toContain('"initialize_managed_user_atomic"');
    expect(route).toContain("await admin.auth.admin.deleteUser(newUserId)");
    expect(route).not.toContain(".upsert(");
    expect(route).not.toContain('.from("user_branches")');
  });
});
