import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00281_atomic_own_profile_update.sql",
  "utf8",
);
const page = readFileSync("src/app/(main)/ho-so/page.tsx", "utf8");

describe("atomic own-profile update", () => {
  it("derives the signed-in user and only updates safe self-service fields", () => {
    expect(migration).toContain("auth.uid()");
    expect(migration).toContain("where p.id = v_actor");
    expect(migration).toContain("set full_name = v_name, phone = v_phone");
    expect(migration).not.toContain("role_id =");
    expect(migration).not.toContain("set tenant_id =");
  });

  it("updates and audits in one server transaction", () => {
    expect(page).toContain('"update_own_profile_atomic"');
    expect(migration).toContain("for update");
    expect(migration).toContain("insert into public.audit_log");
    expect(migration).toContain("'atomic', true");
  });
});
