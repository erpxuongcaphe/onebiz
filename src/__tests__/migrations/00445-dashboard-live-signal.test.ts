import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const sql = readFileSync("supabase/migrations/00445_live_dashboard_invalidation_signals.sql", "utf8");
describe("dashboard realtime data boundary", () => {
  it("publishes only protected signal metadata", () => {
    expect(sql).toContain("alter table public.dashboard_live_signals enable row level security");
    expect(sql).toContain("add table public.dashboard_live_signals");
    expect(sql).not.toMatch(/add table public\.(invoices|cash_transactions)/);
    expect(sql).toContain("p.tenant_id=dashboard_live_signals.tenant_id");
    expect(sql).toContain("public.user_has_branch_access(auth.uid(), branch_id)");
    expect(sql).not.toMatch(/grant (all|insert|update|delete)/i);
  });
  it("does not store amounts or alter financial records/policies", () => {
    expect(sql).not.toMatch(/alter table public\.(invoices|cash_transactions)/);
    expect(sql).not.toMatch(/(?:insert into|update|delete from) public\.(invoices|cash_transactions)/);
    const schema = sql.slice(sql.indexOf("create table"), sql.indexOf("alter table"));
    expect(schema).not.toMatch(/amount|total|customer|payment/);
  });
});
