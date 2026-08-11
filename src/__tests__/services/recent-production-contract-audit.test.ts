import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const focusedPreflight = readFileSync(
  "docs/PREFLIGHT-QC-2-NGAY-2026-08-03.sql",
  "utf8",
);
const allRpcPreflight = readFileSync(
  "docs/PREFLIGHT-ALL-WEB-RPCS-2026-08-03.sql",
  "utf8",
);
const exactRpcPreflight = readFileSync(
  "docs/PREFLIGHT-EXACT-WEB-RPC-CONTRACTS-2026-08-03.sql",
  "utf8",
);
const tableAccessPreflight = readFileSync(
  "docs/PREFLIGHT-WEB-TABLE-ACCESS-2026-08-03.sql",
  "utf8",
);

describe("recent production contract audit", () => {
  it("maps every literal web RPC to a versioned migration function", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/audit-client-rpc-contracts.mjs"],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output) as {
      rpcCallCount: number;
      missingCount: number;
    };

    expect(result.rpcCallCount).toBeGreaterThanOrEqual(200);
    expect(result.missingCount).toBe(0);
  }, 60_000);

  it("matches literal RPC named arguments to a versioned function signature", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/audit-rpc-signatures.mjs"],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output) as {
      checkedCallCount: number;
      mismatchCount: number;
    };

    expect(result.checkedCallCount).toBeGreaterThanOrEqual(220);
    expect(result.mismatchCount).toBe(0);
  }, 60_000);

  it("maps direct table access operations for live RLS verification", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/audit-table-access-contracts.mjs"],
      { encoding: "utf8" },
    );
    const result = JSON.parse(output) as {
      relationCount: number;
      contractCount: number;
    };

    expect(result.relationCount).toBeGreaterThanOrEqual(100);
    expect(result.contractCount).toBeGreaterThanOrEqual(200);
  }, 60_000);

  it("keeps production preflights read-only", () => {
    for (const sql of [
      focusedPreflight,
      allRpcPreflight,
      exactRpcPreflight,
      tableAccessPreflight,
    ]) {
      expect(sql).not.toMatch(
        /^\s*(insert|update|delete|alter|create|drop|truncate|grant|revoke|call|do)\b/im,
      );
    }
  });

  it("checks POS, reports, shifts, permissions and live stored definitions", () => {
    expect(focusedPreflight).toContain("complete_draft_atomic_v5");
    expect(focusedPreflight).toContain("get_receivable_aging_report");
    expect(focusedPreflight).toContain("reconcile_pending_shift");
    expect(focusedPreflight).toContain("REMOVED_PRODUCTS_STATUS");
    expect(focusedPreflight).toContain("get_user_effective_permissions");
    expect(focusedPreflight).toContain("user_branches");
  });
});
