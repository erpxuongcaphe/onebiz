import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync("src/lib/services/supabase/inventory.ts", "utf8");
const cancelMigration = readFileSync(
  "supabase/migrations/00269_atomic_stock_export_cancel.sql",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/00268_atomic_internal_disposal_export_create.sql",
  "utf8",
);

describe("atomic internal and disposal stock exports", () => {
  it("removes multi-step header, item and finalize writes from the client", () => {
    expect(service).toContain('"create_internal_export_atomic"');
    expect(service).toContain('"create_disposal_export_atomic"');
    expect(service).not.toMatch(/createInternalExport[\s\S]{0,1800}\.from\("internal_exports"\)[\s\S]{0,160}\.insert\(/);
    expect(service).not.toMatch(/createDisposalExport[\s\S]{0,1800}\.from\("disposal_exports"\)[\s\S]{0,160}\.insert\(/);
  });

  it("locks stock, validates branch availability, and derives product cost", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for update");
    expect(migration).toContain("INSUFFICIENT_BRANCH_STOCK");
    expect(migration).toContain("p.cost_price");
    expect(migration).toContain("user_has_branch_access");
    expect(migration).toContain("inventory.internal_export");
    expect(migration).toContain("inventory.dispose");
  });

  it("routes draft and completed cancellation through one guarded path", () => {
    expect(service).toContain("cancel_disposal_export_atomic_v2");
    expect(service).toContain("cancel_internal_export_atomic_v2");
    expect(cancelMigration).toContain("for update");
    expect(cancelMigration).toContain("void_disposal_export_atomic");
    expect(cancelMigration).toContain("void_internal_export_atomic");
    expect(cancelMigration).toContain("EXPORT_CANCEL_REASON_REQUIRED");
  });

  it("applies the document and audit in the same database transaction", () => {
    expect(migration).toContain("apply_internal_export_atomic(v_document_id, null)");
    expect(migration).toContain("apply_disposal_export_atomic(v_document_id, null)");
    expect(migration).toContain("insert into public.audit_log");
  });
});
