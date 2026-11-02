import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00279_atomic_managed_user_update.sql",
  "utf8",
);
const route = readFileSync("src/app/api/admin/update-user/route.ts", "utf8");
const page = readFileSync("src/app/(main)/he-thong/users/page.tsx", "utf8");

describe("atomic managed-user update", () => {
  it("derives actor and tenant and uses effective permission instead of job title", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("system.manage_users");
    expect(migration).toContain("public.user_has_permission");
    expect(migration).toContain("ONLY_OWNER_CAN_UPDATE_OWNER");
    expect(migration).toContain("CANNOT_DEACTIVATE_SELF");
  });

  it("replaces branch scope and primary branch inside one transaction", () => {
    expect(migration).toContain("for update");
    expect(migration).toContain("BRANCH_SCOPE_INVALID");
    expect(migration).toContain("delete from public.user_branches");
    expect(migration).toContain("insert into public.user_branches");
    expect(migration).toContain("branch_id = case when p_branch_ids is not null");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'atomic', true");
  });

  it("removes browser-style delete/insert compensation from the server route", () => {
    expect(route).toContain('"update_managed_user_atomic"');
    expect(route).not.toContain("restorePreviousAccess");
    expect(route).not.toContain('.from("user_branches").delete()');
    expect(route).not.toContain('.from("user_branches").insert(');
  });

  it("keeps password reset in a separate action from editing profile access", () => {
    expect(page).toContain("fullName: editForm.fullName.trim()");
    expect(page).toContain("userId: passwordTarget.id, newPassword");
    expect(page).not.toContain("editForm.newPassword");
  });
});
