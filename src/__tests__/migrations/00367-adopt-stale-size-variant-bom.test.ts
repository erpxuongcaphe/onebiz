import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/00367_adopt_stale_size_variant_legacy_bom.sql"),
  "utf8",
).toLowerCase();
const rollback = readFileSync(
  resolve(root, "supabase/migrations/00367_rollback_adopt_stale_size_variant_legacy_bom.sql"),
  "utf8",
).toLowerCase();

describe("00367 stale size variant legacy BOM adoption", () => {
  it("keeps adoption inside the guarded atomic wrapper", () => {
    expect(migration).toContain("security definer");
    expect(migration).toContain("for update");
    expect(migration).toContain(
      "return public.save_fnb_size_setup_atomic_00357(p_product_id, p_variants)",
    );
  });

  it("permits only the exact requested variant for the same product", () => {
    expect(migration).toContain("existing_variant.product_id <> p_product_id");
    expect(migration).toContain("v_variant_id is null");
    expect(migration).toContain("existing_variant.id <> v_variant_id");
    expect(migration).toContain("bom.product_id = p_product_id");
    expect(migration).toContain("bom.tenant_id = v_tenant");
  });

  it("keeps the inner RPC private and the wrapper authenticated-only", () => {
    expect(migration).toContain(
      "revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)",
    );
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to authenticated");
  });

  it("provides a rollback to the stricter 00366 behavior", () => {
    expect(rollback).toContain("create or replace function public.save_fnb_size_setup_atomic");
    expect(rollback).not.toContain("existing_variant.id <> v_variant_id");
    expect(rollback).toContain("00366:");
  });
});
