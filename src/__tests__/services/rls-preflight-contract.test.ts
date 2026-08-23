import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const staticPreflight = readFileSync(
  "docs/PREFLIGHT-WEB-TABLE-ACCESS-2026-08-03.sql",
  "utf8",
);
const rlsPreflight = readFileSync(
  "docs/qc/sql/RLS-PREFLIGHT-READONLY.sql",
  "utf8",
);
const fullRlsInventory = readFileSync(
  "docs/qc/sql/RLS-TOAN-CUC-PREFLIGHT-READONLY.sql",
  "utf8",
);

function normalizeSql(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

describe("RLS preflight contracts", () => {
  it("keeps the frozen web-table preflight aligned with the current static audit", () => {
    const generated = execFileSync(
      process.execPath,
      ["scripts/audit-table-access-contracts.mjs", "--sql"],
      { encoding: "utf8" },
    );

    expect(normalizeSql(staticPreflight)).toBe(normalizeSql(generated));
  }, 60_000);

  it("keeps both RLS preflights read-only", () => {
    for (const sql of [staticPreflight, rlsPreflight, fullRlsInventory]) {
      expect(sql).not.toMatch(
        /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke|call|do)\b/im,
      );
    }
  });

  it("keeps the withdrawn mass-RLS migration visibly blocked", () => {
    const withdrawn = readFileSync(
      "supabase/migrations/00241_rls_layer2_batch2.sql",
      "utf8",
    );

    expect(withdrawn).toContain("00241 đã bị thu hồi");
    expect(withdrawn).toContain("raise exception");
  });
});
