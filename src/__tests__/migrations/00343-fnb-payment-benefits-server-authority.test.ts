import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "00343_fnb_payment_benefits_server_authority.sql"),
  "utf8",
);
const rollback = readFileSync(
  join(root, "supabase", "migrations", "00343_rollback_fnb_payment_benefits_server_authority.sql"),
  "utf8",
);

function normalizeNewlines(content: string) {
  return content.replace(/\r\n/g, "\n");
}

function commandLinePositions(sql: string, command: "begin" | "commit" | "notify") {
  return sql
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim().toLowerCase(), index }))
    .filter(({ line }) =>
      command === "notify"
        ? /^notify\s+pgrst\s*,/i.test(line)
        : line === `${command};`,
    )
    .map(({ index }) => index);
}

describe("00343 - server authority for F&B payment benefits", () => {
  it("adds V3 without changing the live V2 entrypoint", () => {
    expect(migration).toContain("create or replace function public.fnb_complete_payment_atomic_v3");
    expect(migration).not.toMatch(/revoke\s+all\s+on\s+function\s+public\.fnb_complete_payment_atomic_v2/i);
  });

  it("keeps all definition changes transactional and reloads schema after commit", () => {
    for (const sql of [migration, rollback]) {
      const begin = commandLinePositions(sql, "begin");
      const commit = commandLinePositions(sql, "commit");
      const notify = commandLinePositions(sql, "notify");
      expect(begin).toHaveLength(1);
      expect(commit).toHaveLength(1);
      expect(notify).toHaveLength(1);
      expect(begin[0]).toBeLessThan(commit[0]);
      expect(commit[0]).toBeLessThan(notify[0]);
    }
  });

  it("keeps automatic money calculation, OTP verification, and audit inside V3", () => {
    expect(migration).toContain("public.verify_otp_authorization(");
    expect(migration).toContain("public.increment_promotion_usage");
    expect(migration).toContain("public.apply_coupon_atomic");
    expect(migration).toContain("fnb_checkout_benefits_server_calculated");
    expect(migration).toContain("FNB_TOTAL_DISCOUNT_EXCEEDS_ORDER");
    expect(migration).toContain("v_order.discount_amount + v_total_discount > v_order_subtotal");
    expect(migration).toContain("'platform_commission_amount', v_invoice_commission_amount");
    expect(migration).toContain("p_allow_debt boolean");
    expect(migration).toContain("FNB_PAYMENT_AMOUNT_CHANGED");
    expect(migration).toContain("FNB_DEBT_CONFIRMATION_REQUIRED");
    expect(migration).toContain("FNB_PAYMENT_BREAKDOWN_MISMATCH");
    expect(migration).toContain("'paid_recorded', v_paid_to_record");
    expect(migration).toContain("v_paid_to_record := least(p_paid, v_expected_total)");
    expect(migration).toContain("'tendered_amount', v_tendered_to_display");
    expect(migration).toContain("FNB_PAYMENT_BREAKDOWN_DUPLICATE_METHOD");
  });

  it("delivers the exact migration and rollback files to SQL-CAN-CHAY", () => {
    const deliveredMigration = readFileSync(
      join(root, "SQL-CAN-CHAY", "00343-BUOC-2-CHAY-MIGRATION.sql"),
      "utf8",
    );
    const deliveredRollback = readFileSync(
      join(root, "SQL-CAN-CHAY", "00343-HOAN-TAC-CHI-DUNG-KHI-CAN.sql"),
      "utf8",
    );

    expect(normalizeNewlines(deliveredMigration)).toBe(normalizeNewlines(migration));
    expect(normalizeNewlines(deliveredRollback)).toBe(normalizeNewlines(rollback));
  });

  it("keeps the preflight and postflight scripts read-only", () => {
    const scripts = [
      "00343-BUOC-1-KIEM-TRUOC-THANH-TOAN-UU-DAI-FNB.sql",
      "00343-BUOC-3-KIEM-SAU-THANH-TOAN-UU-DAI-FNB.sql",
    ].map((file) =>
      readFileSync(join(root, "SQL-CAN-CHAY", file), "utf8"),
    );

    for (const script of scripts) {
      expect(script).not.toMatch(/^\s*(insert|update|delete|alter|create|drop|grant|revoke|notify)\b/im);
    }

    expect(scripts[1]).toContain("P6_V3_CO_GUARD_TIEN_VA_GHI_NO");
    expect(scripts[1]).toContain("FNB_PAYMENT_BREAKDOWN_MISMATCH");
    expect(scripts[1]).toContain("FNB_DEBT_CONFIRMATION_REQUIRED");
    expect(scripts[1]).toContain("tendered_amount");
    const executablePostflight = scripts[1]
      .replace(/^--.*$/gm, "")
      .trim();
    expect(executablePostflight.endsWith(";")).toBe(true);
    expect(executablePostflight.slice(0, -1)).not.toContain(";");
    expect(scripts[1]).toContain("union all");
  });
});
