import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const migration = read("supabase/migrations/00356_atomic_product_modifier_groups.sql");
const rollback = read("supabase/migrations/00356_rollback_atomic_product_modifier_groups.sql");
const preflight = read(
  "docs/qc/sql/00356-FNB-PRODUCT-MODIFIER-ATOMIC-PREFLIGHT-READONLY.sql",
);
const postflight = read(
  "docs/qc/sql/00356-FNB-PRODUCT-MODIFIER-ATOMIC-POSTFLIGHT-READONLY.sql",
);
const service = read("src/lib/services/supabase/modifier-groups.ts");

describe("00356 atomic product modifier groups", () => {
  it("wraps the complete replacement in one guarded RPC", () => {
    expect(migration).toContain("begin;");
    expect(migration).toContain("for update");
    expect(migration).toContain("user_has_permission(v_actor, 'products.edit')");
    expect(migration).toContain("p.tenant_id = v_tenant");
    expect(migration).toContain("g.channel in ('fnb', 'all')");
    expect(migration).toContain("delete from public.product_modifier_groups");
    expect(migration).toContain("insert into public.product_modifier_groups");
    expect(migration).toContain("with ordinality");
    expect(migration).toContain("commit;");
  });

  it("does not expose the write RPC to anonymous roles", () => {
    expect(migration).toContain("from public, anon, authenticated, service_role");
    expect(migration).toContain("to authenticated");
  });

  it("uses the atomic RPC instead of browser delete and insert", () => {
    const start = service.indexOf("export async function setProductModifierGroups");
    const end = service.indexOf("\n}\n", start) + 2;
    const implementation = service.slice(start, end);
    expect(implementation).toContain('"save_product_modifier_groups_atomic"');
    expect(implementation).not.toContain('.from("product_modifier_groups")');
    expect(implementation).not.toContain(".delete()");
    expect(implementation).not.toContain(".insert(");
  });

  it("has a rollback that only removes the new RPC", () => {
    expect(rollback).toContain(
      "drop function if exists public.save_product_modifier_groups_atomic(uuid, uuid[])",
    );
    expect(rollback).not.toContain("delete from public.product_modifier_groups");
    expect(rollback).not.toContain("update public.product_modifier_groups");
  });

  it("keeps preflight and postflight read-only", () => {
    for (const sql of [preflight, postflight]) {
      expect(sql).not.toMatch(
        /^\s*(insert|update|delete|alter|create|drop|grant|revoke)\b/gim,
      );
    }
    expect(preflight).toContain("P3_00356_CHUA_CAI");
    expect(postflight).toContain("K4_QUYEN_GOI");
  });
});
