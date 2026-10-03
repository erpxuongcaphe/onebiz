import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const patch = readFileSync("supabase/migrations/00420_fnb_transfer_business_conflict.sql", "utf8");
const source = readFileSync("supabase/migrations/00321_harden_fnb_transfer_table.sql", "utf8");

describe("F&B transfer business SQLSTATE patch", () => {
  it("targets exactly the two stale ownership guards", () => {
    expect(source.match(/raise exception using errcode = '40001', message = 'FNB_TRANSFER_SOURCE_STALE';/g)).toHaveLength(2);
    expect(patch).toContain("v_old_count <> 2 or v_new_count <> 0");
    expect(patch).toContain("v_old_count = 0 and v_new_count = 2");
    expect(patch).toContain("execute replace(v_definition, v_old, v_new)");
    expect(patch).toContain("''PT409''");
  });
  it("does not write business rows or alter permissions", () => {
    expect(patch).not.toMatch(/\b(update|delete|insert|truncate|grant|revoke)\b/i);
    expect(patch).toContain("user_has_branch_access");
    expect(patch).toContain("pos_fnb.transfer_table");
    expect(patch).toContain("definition verification failed");
  });
});
