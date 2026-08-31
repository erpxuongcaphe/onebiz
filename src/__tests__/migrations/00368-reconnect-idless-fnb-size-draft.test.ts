import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/00368_reconnect_idless_fnb_size_drafts.sql"),
  "utf8",
).toLowerCase();
const rollback = readFileSync(
  resolve(root, "supabase/migrations/00368_rollback_reconnect_idless_fnb_size_drafts.sql"),
  "utf8",
).toLowerCase();

describe("00368 reconnect id-less FnB size drafts", () => {
  it("preserves 00367 as a private guarded layer", () => {
    expect(migration).toContain("rename to save_fnb_size_setup_atomic_00367");
    expect(migration).toContain(
      "revoke all on function public.save_fnb_size_setup_atomic_00367",
    );
    expect(migration).toContain(
      "return public.save_fnb_size_setup_atomic_00367",
    );
  });

  it("matches only one active variant by tenant, product, name and BOM code", () => {
    expect(migration).toContain("existing_variant.tenant_id = v_tenant");
    expect(migration).toContain("existing_variant.product_id = p_product_id");
    expect(migration).toContain("existing_variant.is_active");
    expect(migration).toContain("lower(trim(existing_variant.name)) = lower(v_name)");
    expect(migration).toContain(
      "lower(trim(existing_variant.bom_code)) = lower(v_bom_code)",
    );
    expect(migration).toContain("if v_candidate_count = 1 then");
    expect(migration).toContain("jsonb_set");
  });

  it("keeps the public wrapper authenticated-only", () => {
    expect(migration).toContain(
      "revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)",
    );
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to authenticated");
  });

  it("rolls back to the 00367 wrapper", () => {
    expect(rollback).toContain(
      "alter function public.save_fnb_size_setup_atomic_00367(uuid, jsonb)",
    );
    expect(rollback).toContain("rename to save_fnb_size_setup_atomic");
    expect(rollback).toContain("00367:");
  });
});
