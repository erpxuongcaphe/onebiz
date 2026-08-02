import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compatibilityMigration = readFileSync(
  "supabase/migrations/00292_pos_draft_revision_guard.sql",
  "utf8",
);
const enforcementMigration = readFileSync(
  "supabase/migrations/00293_enforce_pos_draft_revision_guard.sql",
  "utf8",
);
const orderService = readFileSync(
  "src/lib/services/supabase/orders.ts",
  "utf8",
);
const integrityService = readFileSync(
  "src/lib/services/supabase/pos-integrity.ts",
  "utf8",
);

describe("POS draft revision guard", () => {
  it("locks the draft and rejects stale revisions or sessions", () => {
    expect(compatibilityMigration).toContain(
      "add column if not exists draft_revision",
    );
    expect(compatibilityMigration).toContain("for update");
    expect(compatibilityMigration).toContain("POS_SESSION_REQUIRED");
    expect(compatibilityMigration).toContain("POS_DRAFT_CONFLICT");
    expect(compatibilityMigration).toContain("POS_DRAFT_SESSION_CHANGED");
    expect(compatibilityMigration).toContain(
      "draft_revision = draft_revision + 1",
    );
  });

  it("requires revision, session and expected total at checkout", () => {
    expect(compatibilityMigration).toContain("complete_draft_atomic_v5");
    expect(compatibilityMigration).toContain("p_expected_revision bigint");
    expect(compatibilityMigration).toContain("p_expected_total numeric");
    expect(compatibilityMigration).toContain("POS_CART_TOTAL_CHANGED");
    expect(orderService).toContain('"complete_draft_atomic_v5"');
    expect(orderService).toContain(
      "p_expected_revision: payment.expectedRevision",
    );
    expect(orderService).toContain("p_expected_total: payment.expectedTotal");
  });

  it("keeps the integrity report read-only", () => {
    const reportSection = compatibilityMigration.slice(
      compatibilityMigration.indexOf(
        "create or replace function public.get_pos_invoice_integrity_report",
      ),
      compatibilityMigration.indexOf(
        "revoke all on function public.get_pos_invoice_integrity_report",
      ),
    );

    expect(reportSection).toContain("return query");
    expect(reportSection).toContain("system.view_audit");
    expect(reportSection).not.toMatch(/\binsert\s+into\b/i);
    expect(reportSection).not.toMatch(/\bupdate\s+public\./i);
    expect(reportSection).not.toMatch(/\bdelete\s+from\b/i);
    expect(integrityService).toContain('"get_pos_invoice_integrity_report"');
  });

  it("revokes legacy write RPCs only in the post-deploy migration", () => {
    expect(compatibilityMigration).not.toContain(
      "revoke execute on function public.save_pos_draft_atomic_v2",
    );
    expect(enforcementMigration).toContain(
      "revoke execute on function public.save_pos_draft_atomic_v2",
    );
    expect(enforcementMigration).toContain(
      "revoke execute on function public.complete_draft_atomic_v4",
    );
  });
});
