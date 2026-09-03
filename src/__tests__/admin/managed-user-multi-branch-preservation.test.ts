import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const service = readFileSync(join(root, "src/lib/services/supabase/roles.ts"), "utf8");
const page = readFileSync(join(root, "src/app/(main)/he-thong/users/page.tsx"), "utf8");
const migration = readFileSync(
  join(root, "supabase/migrations/00371_harden_user_branch_writes.sql"),
  "utf8",
);

describe("managed user multi-branch preservation", () => {
  it("loads every assigned branch and initializes edit from the full list", () => {
    expect(service).toContain('.from("user_branches")');
    expect(service).toContain('branchIds: [...assigned]');
    expect(page).toContain("branchIds: user.branchIds");
    expect(page).not.toContain("branchIds: user.branchId ? [user.branchId] : []");
  });

  it("blocks browser writes to branch assignments", () => {
    expect(migration).toContain("revoke insert, update, delete on table public.user_branches");
    expect(migration).toContain("update_managed_user_atomic(uuid,jsonb,uuid[])");
    expect(migration).toContain("initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])");
  });
});
