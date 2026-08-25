import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]) =>
  fs.readFileSync(path.join(root, ...segments), "utf8");

const migration = read(
  "supabase",
  "migrations",
  "00346_revoke_direct_kds_writes.sql",
);
const rollback = read(
  "supabase",
  "migrations",
  "00346_rollback_revoke_direct_kds_writes.sql",
);
const runCopy = read(
  "SQL-CAN-CHAY",
  "00346-BUOC-2-CHAY-KHOA-GHI-TRUC-TIEP-DON-BEP.sql",
);
const rollbackCopy = read(
  "SQL-CAN-CHAY",
  "00346-HOAN-TAC-CHI-DUNG-KHI-CAN.sql",
);
const preflight = read(
  "SQL-CAN-CHAY",
  "00346-BUOC-1-KIEM-TRUOC-KHOA-GHI-DON-BEP.sql",
);
const postflight = read(
  "SQL-CAN-CHAY",
  "00346-BUOC-3-KIEM-SAU-KHOA-GHI-DON-BEP.sql",
);

const KDS_TABLES = [
  "public.kitchen_orders",
  "public.kitchen_order_items",
  "public.pos_exception_events",
] as const;

describe("00346 - lock direct KDS writes", () => {
  it("ships the exact reviewed migration and rollback to the operational SQL folder", () => {
    expect(runCopy).toBe(migration);
    expect(rollbackCopy).toBe(rollback);
  });

  it("requires the secured KDS and cashier RPCs before changing privileges", () => {
    for (const name of [
      "_fnb_cancel_unpaid_order_impl_00066",
      "_fnb_void_invoice_impl_00329",
      "_fnb_complete_payment_impl_00343",
      "fnb_send_to_kitchen_atomic_v2",
      "fnb_update_kitchen_item_status_v2",
      "fnb_update_kitchen_order_status_v2",
      "fnb_cancel_unpaid_order_atomic",
      "fnb_void_invoice_atomic",
      "fnb_complete_payment_atomic_v3",
    ]) {
      expect(migration).toContain(name);
    }
    expect(migration).toContain("FNB_00346_RPC_SECURITY_PREREQUISITE_CHANGED");
  });

  it("revokes every direct write operation from browser roles without touching finance tables", () => {
    for (const table of KDS_TABLES) {
      expect(migration).toContain(
        `revoke insert, update, delete, truncate on table ${table}`,
      );
    }
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).not.toMatch(/on table public\.(?:invoices|invoice_items|cash_transactions)\b/i);
  });

  it("is atomic, reloads the API schema only after commit, and has a checked rollback", () => {
    expect(migration).toMatch(/^begin;/m);
    expect(migration).toMatch(/commit;[\s\S]*notify pgrst, 'reload schema';/);
    expect(rollback).toMatch(/^begin;/m);
    expect(rollback).toMatch(/commit;[\s\S]*notify pgrst, 'reload schema';/);
    expect(rollback).toContain("FNB_00346_ROLLBACK_GRANT_INVALID");
    expect(rollback).toContain("grant insert, update, delete on table public.kitchen_orders to authenticated");
    expect(rollback).not.toMatch(/grant\s+.+\s+to\s+(?:anon|public)\b/i);
  });

  it("keeps postflight read-only and tests both anon and authenticated effective privileges", () => {
    expect(preflight).toContain("P1_HAM_NOI_BO_DA_KHOA");
    expect(preflight).toContain("P2_RPC_CONG_KHAI_AN_TOAN");
    expect(preflight).toContain("and not authenticated_goi_duoc");
    expect(preflight).toContain("where la_ham_noi_bo");
    expect(preflight).toContain("where not la_ham_noi_bo");
    expect(postflight).toContain("K0_HAM_NOI_BO_DA_KHOA");
    expect(postflight).toContain("K1_RPC_THAY_THE_CON_AN_TOAN");
    expect(postflight).toContain("K2_KHOA_GHI_TRUC_TIEP");
    expect(postflight).toContain("'anon'");
    expect(postflight).toContain("'authenticated'");
    expect(postflight).not.toMatch(/\b(?:insert\s+into|update\s+public|delete\s+from|alter\s+table)\b/i);
    expect(preflight).not.toMatch(/\b(?:insert\s+into|update\s+public|delete\s+from|alter\s+table)\b/i);
  });
});
