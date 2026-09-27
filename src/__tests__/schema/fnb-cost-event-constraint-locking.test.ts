import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMigration = (name: string) =>
  readFileSync(`supabase/migrations/${name}`, "utf8").toLowerCase();

describe("F&B cost event source constraint rollout", () => {
  it("keeps each allowlist expansion short and avoids validating the table in-place", () => {
    for (const name of [
      "00397_fnb_return_bom_cost_restore.sql",
      "00398_fnb_production_cancel_cost_restore.sql",
      "00399_fnb_purchase_revert_cost_ledger.sql",
      "00400_fnb_inventory_adjustment_transfer_cost.sql",
    ]) {
      const migration = readMigration(name);
      expect(migration).toContain("set local lock_timeout = '1s'");
      expect(migration).toMatch(/check\s*\(source_type in\s*\([\s\S]*?\)\s*\)\s*not valid/);
      expect(migration).not.toMatch(/validate\s+constraint/);
    }
  });

  it("validates the expanded allowlist in a separate final migration", () => {
    const migration = readMigration(
      "00401_validate_fnb_branch_cost_event_source_type.sql",
    );
    expect(migration).toContain("set local lock_timeout = '1s'");
    expect(migration).toContain(
      "validate constraint fnb_branch_product_cost_events_source_type_check",
    );
    expect(migration).toContain("and c.convalidated");
    const integration = readFileSync(
      "supabase/tests/00401_validate_fnb_branch_cost_event_source_type.integration.sql",
      "utf8",
    ).toLowerCase();
    expect(integration).toContain("not c.convalidated");
    expect(integration).toContain("not valid source type allowlist did not reject");
    expect(integration).toContain("\\ir ../migrations/00401_validate_fnb_branch_cost_event_source_type.sql");
  });

  it("reports cost markers only for functions that own those behaviors", () => {
    const preflight = readFileSync(
      "docs/qc/sql/00397-00400-FNB-COST-PREFLIGHT-READONLY.sql",
      "utf8",
    )
      .replace(/\r\n/g, "\n")
      .toLowerCase();
    expect(preflight).toContain("case\n    when p.oid = to_regprocedure('public._capture_fnb_branch_cost_stock_movement_00390()')");
    expect(preflight).toContain("case\n    when p.oid = to_regprocedure('public.complete_stock_transfer_atomic(uuid,uuid,uuid)')");
    expect(preflight).toContain("c.convalidated");
  });
});
