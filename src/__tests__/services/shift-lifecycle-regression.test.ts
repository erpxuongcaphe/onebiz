import fs from "node:fs";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  "supabase/migrations/00298_fix_shift_open_close_reconcile_flow.sql",
  "utf8",
);
const timezoneMigration = fs.readFileSync(
  "supabase/migrations/00302_fix_shift_cutoff_timezone.sql",
  "utf8",
);
const service = fs.readFileSync(
  "src/lib/services/supabase/shifts.ts",
  "utf8",
);

const retailPosPage = fs.readFileSync("src/app/pos/page.tsx", "utf8");

describe("shift lifecycle regression", () => {
  it("never flips a pending shift back to open before reconciliation", () => {
    const reconcile = migration.slice(
      migration.indexOf("create or replace function public.reconcile_pending_shift"),
    );
    expect(reconcile).not.toContain("set status = 'open'");
    expect(reconcile).toContain("'pending_reconcile'");
    expect(reconcile).toContain("_finalize_shift_atomic_00298");
  });

  it("serializes shift opening and recovers an existing open shift", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("'already_open', v_already_open");
    expect(migration).toContain("and s.status = 'open'");
  });

  it("keeps close and reconcile totals on one shared finalizer", () => {
    expect(migration.match(/_finalize_shift_atomic_00298\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(migration).toContain("ct.reference_type in ('invoice', 'sales_return')");
    expect(migration).toContain("i.status = 'completed'");
  });

  it("uses the atomic open RPC from the web service", () => {
    expect(service).toContain('"open_shift_atomic"');
    expect(service).not.toContain('.from("shifts")\n    .insert({');
  });

  it("calculates the overdue cutoff locally before converting it", () => {
    expect(timezoneMigration).toContain(
      "v_local_now := now() at time zone 'Asia/Ho_Chi_Minh'",
    );
    expect(timezoneMigration).toContain(
      "v_threshold := v_local_threshold at time zone 'Asia/Ho_Chi_Minh'",
    );
    expect(timezoneMigration).toContain("where tenant_id = v_actor_tenant");
  });

  it("rechecks the server shift before asking the cashier to open another one", () => {
    const handler = retailPosPage.slice(
      retailPosPage.indexOf("const handleComplete = useCallback"),
      retailPosPage.indexOf("// CEO 04/05/2026: Bỏ handleDebtCheckout"),
    );
    expect(handler.indexOf("await getOpenShift")).toBeGreaterThanOrEqual(0);
    expect(handler.indexOf("await getOpenShift")).toBeLessThan(
      handler.indexOf('title: "Chưa mở ca"'),
    );
    expect(handler).toContain("shiftId: checkoutShift.id");
  });});
