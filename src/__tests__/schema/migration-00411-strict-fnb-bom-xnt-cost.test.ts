import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00411_strict_fnb_bom_xnt_cost.sql",
  "utf8",
);
const internalSaleMigration = readFileSync(
  "supabase/migrations/00409_xnt_internal_sale_branch_cost.sql",
  "utf8",
);

describe("strict F&B BOM cost source for XNT", () => {
  it("requires a branch ledger event for tracked BOM consumption", () => {
    expect(migration).toContain("movement.type = 'out'");
    expect(migration).toContain("movement.reference_type = 'bom_consume'");
    expect(migration).toContain(
      "public._fnb_branch_cost_tracking_enabled_00390(",
    );
    expect(migration).toContain("then null::numeric");
  });

  it("preserves the existing internal-sale resolver and limits the patch to XNT", () => {
    expect(migration).toContain("internal_sale_cost.total_cost");
    expect(migration).toContain("get_xnt_report_v2(");
    expect(migration).not.toMatch(/\b(update|delete|insert)\s+public\./i);
    expect(internalSaleMigration).toContain(
      "movement.reference_type = 'internal_sale'",
    );
    expect(internalSaleMigration).toContain("when movement.unit_cost is not null");
  });

  it("keeps movement cost events ahead of the strict F&B BOM guard", () => {
    expect(internalSaleMigration).toContain(
      "when cost_event.total_cost is not null then cost_event.total_cost",
    );
    expect(migration).toContain("movement.type = 'out'");
    expect(migration).toContain("movement.reference_type = 'bom_consume'");
    expect(migration).toContain(
      "public._fnb_branch_cost_tracking_enabled_00390(",
    );
    expect(migration).toContain("then null::numeric");
    expect(migration).toContain("execute regexp_replace(v_definition");
  });

  it("inserts strict BOM handling before the generic legacy snapshot fallback", () => {
    const strictBranch = migration.indexOf(
      "movement.reference_type = 'bom_consume'",
    );
    const internalSaleAnchor = migration.indexOf(
      "when movement.type = 'in'\n         and movement.reference_type = 'internal_sale'",
    );
    const genericFallback = internalSaleMigration.indexOf(
      "when movement.unit_cost is not null",
    );
    const internalSaleBranch = internalSaleMigration.indexOf(
      "when movement.type = 'in'\n         and movement.reference_type = 'internal_sale'",
    );

    expect(strictBranch).toBeGreaterThanOrEqual(0);
    expect(internalSaleAnchor).toBeGreaterThan(strictBranch);
    expect(internalSaleBranch).toBeGreaterThan(0);
    expect(genericFallback).toBeGreaterThan(0);
    expect(genericFallback).toBeGreaterThan(internalSaleBranch);
    expect(migration).toContain("v_count <> 1");
  });
});

