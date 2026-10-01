import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/00413_enable_branch_scoped_kds_realtime.sql",
  "utf8",
);

describe("00413 KDS realtime publication", () => {
  it("publishes only branch-scoped kitchen orders", () => {
    expect(migration).toContain(
      "alter publication supabase_realtime add table public.kitchen_orders",
    );
    expect(migration).not.toMatch(/add table public\.kitchen_order_items/i);
    expect(migration).toContain("c.relrowsecurity");
    expect(migration).toContain("cmd in ('SELECT', 'ALL')");
  });

  it("is idempotent and does not modify business rows", () => {
    expect(migration).toContain("set local lock_timeout = '1s'");
    expect(migration).toContain("if not exists (");
    expect(migration).not.toMatch(/\b(insert|update|delete|truncate)\s+(into|from|public\.)/i);
  });
});
