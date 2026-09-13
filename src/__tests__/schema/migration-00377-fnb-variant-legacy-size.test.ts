import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/00377_fnb_variant_satisfies_legacy_size_modifier.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(root, "supabase/migrations/00377_rollback_fnb_variant_satisfies_legacy_size_modifier.sql"),
  "utf8",
);
const legacy00303 = readFileSync(
  join(root, "supabase/migrations/00303_fnb_topping_compat_phase1.sql"),
  "utf8",
);

function functionDefinition(source: string, functionName: string): string {
  const start = source.indexOf(`create or replace function public.${functionName}(`);
  const end = source.indexOf("\n$$;", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 4).replaceAll("\r\n", "\n");
}

describe("migration 00377 - variant replaces legacy Size modifier", () => {
  it("patches only the private FnB implementation and preserves the wrapper chain", () => {
    expect(migration).toContain("public._fnb_send_to_kitchen_impl_00303");
    expect(migration).toContain("_fnb_send_to_kitchen_impl_00353");
    expect(migration).not.toContain("create or replace function public.open_shift_atomic");
    expect(migration).not.toContain("insert into public.products");
    expect(migration).not.toContain("update public.products");
  });

  it("accepts a validated variant as Size but keeps all other required modifiers", () => {
    expect(migration).toContain("v_variant_id is not null");
    expect(migration).toContain("lower(btrim(mg.name)) = 'size'");
    expect(migration).toContain("REQUIRED_MODIFIER_MISSING");
    expect(migration).toContain("PRODUCT_VARIANT_NOT_AVAILABLE");
  });

  it("rejects a duplicate legacy Size selection to avoid double price or stock effects", () => {
    expect(migration).toContain("LEGACY_SIZE_MODIFIER_NOT_ALLOWED");
    expect(migration).toContain("00377_REJECT_DUPLICATE_LEGACY_SIZE");
  });

  it("keeps the proven 00303 business implementation byte-for-byte apart from the two Size guards", () => {
    const requiredPatch = `
        and not (
          v_variant_id is not null
          and lower(btrim(mg.name)) = 'size'
        ) /* 00377_VARIANT_SATISFIES_LEGACY_SIZE */`;
    const duplicatePatch = `
      if v_variant_id is not null and lower(btrim(v_group.name)) = 'size' then
        raise exception 'LEGACY_SIZE_MODIFIER_NOT_ALLOWED' using errcode = 'P0001';
      end if; /* 00377_REJECT_DUPLICATE_LEGACY_SIZE */`;
    const actual = functionDefinition(
      migration,
      "_fnb_send_to_kitchen_impl_00303",
    )
      .replace(requiredPatch, "")
      .replace(duplicatePatch, "")
      .replace(
        "create or replace function public._fnb_send_to_kitchen_impl_00303(",
        "create or replace function public.fnb_send_to_kitchen_atomic_v2(",
      );
    const expected = functionDefinition(
      legacy00303,
      "fnb_send_to_kitchen_atomic_v2",
    );
    expect(actual).toBe(expected);
  });

  it("is transactional, least-privilege and reversible", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("commit;");
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(rollback).toContain("00377_VARIANT_SATISFIES_LEGACY_SIZE");
    expect(rollback).toContain("_fnb_send_to_kitchen_impl_before_00377");
  });
});
