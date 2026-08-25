import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

const migration = read("supabase/migrations/00345_harden_fnb_cashier_transaction_rpcs.sql");
const rollback = read("supabase/migrations/00345_rollback_harden_fnb_cashier_transaction_rpcs.sql");
const postflight = read("SQL-CAN-CHAY/00345-KIEM-SAU-KHOA-GIAO-DICH-THU-NGAN-FNB.sql");
const operationalMigration = read("SQL-CAN-CHAY/00345-CHAY-KHOA-GIAO-DICH-THU-NGAN-FNB.sql");
const operationalRollback = read("SQL-CAN-CHAY/00345-HOAN-TAC-CHI-DUNG-KHI-CAN.sql");

describe("00345 - F&B cashier transaction RPC wrappers", () => {
  it("pins exactly the production functions that were preflighted", () => {
    expect(migration).toContain("98c111067f26bb274f56c541dd6d509a");
    expect(migration).toContain("7425690d872c1c7648258f8ebb1d220a");
    expect(migration).toContain("d6b2f919f9e5e63a231aae7ed7096452");
  });

  it("wraps rather than copies the payment, void, and cancel engines", () => {
    expect(migration).toContain("rename to _fnb_cancel_unpaid_order_impl_00066");
    expect(migration).toContain("rename to _fnb_void_invoice_impl_00329");
    expect(migration).toContain("rename to _fnb_complete_payment_impl_00343");
    expect(migration).toContain("return public._fnb_void_invoice_impl_00329(");
    expect(migration).toContain("return public._fnb_complete_payment_impl_00343(");
    expect(migration).toContain("_fnb_void_invoice_impl_00165");
  });

  it("locks the cashier actor, branch, invoice/order link, and active shift", () => {
    expect(migration).toContain("FNB_CANCEL_BRANCH_ACCESS_DENIED");
    expect(migration).toContain("FNB_VOID_ACTOR_MISMATCH");
    expect(migration).toContain("FNB_VOID_ORDER_INVOICE_MISMATCH");
    expect(migration).toContain("FNB_PAYMENT_OPEN_SHIFT_REQUIRED");
    expect(migration).toContain("s.cashier_id = v_actor");
  });

  it("keeps completed-payment retries idempotent without requiring a new shift", () => {
    const paymentWrapper = migration.split("create or replace function public.fnb_complete_payment_atomic_v3")[1];
    const retryIndex = paymentWrapper.indexOf("if v_order.invoice_id is not null");
    const shiftRequiredIndex = paymentWrapper.indexOf("FNB_PAYMENT_OPEN_SHIFT_REQUIRED");
    expect(retryIndex).toBeGreaterThanOrEqual(0);
    expect(shiftRequiredIndex).toBeGreaterThan(retryIndex);
  });

  it("hides internal entrypoints and reloads the API schema only after commit", () => {
    expect(migration).toMatch(/revoke all on function public\._fnb_cancel_unpaid_order_impl_00066[\s\S]{0,160}from public, anon, authenticated;/);
    expect(migration).toMatch(/commit;\nnotify pgrst, 'reload schema';/);
    expect(migration).not.toContain("has_function_privilege('public'");
  });

  it("can roll back the wrapper layer without touching business rows", () => {
    expect(rollback).toContain("rename to fnb_cancel_unpaid_order_atomic");
    expect(rollback).toContain("rename to fnb_void_invoice_atomic");
    expect(rollback).toContain("rename to fnb_complete_payment_atomic_v3");
    expect(rollback).not.toMatch(/\b(update|insert into|delete from)\s+public\.(invoices|kitchen_orders|stock_movements|cash_transactions)/i);
  });

  it("keeps the files delivered for SQL Editor byte-for-byte aligned with the migrations", () => {
    expect(operationalMigration).toBe(migration);
    expect(operationalRollback).toBe(rollback);
  });

  it("ships a read-only postflight that keeps direct table writes explicitly out of scope", () => {
    expect(postflight).toContain("HAU KIEM CHI DOC");
    expect(postflight).toContain("I1_GIOI_HAN_00345");
    expect(postflight).toContain("Quyen ghi truc tiep bang du lieu FnB");
  });
});
