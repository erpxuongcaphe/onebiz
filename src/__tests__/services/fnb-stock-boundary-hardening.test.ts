import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe,it,expect} from "vitest";
const sql=readFileSync(join(process.cwd(),"supabase/migrations/00562_fnb_stock_boundary_and_lot_allocation.sql"),"utf8");
describe("FnB inventory boundary and lot hardening",()=>{
 it("uses exact expiry and never silently skips locked lots",()=>{
  expect(sql).toContain("_lot_expiry_moment_00527");
  expect(sql).toContain(">allocation_time");
  expect(sql).not.toMatch(/for update skip locked/i);
 });
 it("patches all known swallow-error allocation boundaries with guards",()=>{
  expect(sql).toContain("FNB_00562_ALLOCATION_BOUNDARY_CHANGED");
  expect(sql).toContain("calls<>(case");
  expect(sql).toContain("_fnb_complete_payment_impl_00230");
  expect(sql).toContain("_allocate_fnb_sale_lots_00562");
 });
 it("locks the whole bill before posting, while preserving replay",()=>{
  expect(sql).toContain("if v_order.invoice_id is null then");
  expect(sql).toContain("order by p.id for update");
  expect(sql).toContain("FNB_STOCK_PRODUCT_SCOPE_INVALID");
 });
 it("keeps quantity rules and past documents untouched",()=>{
  expect(sql).not.toMatch(/(?:update|delete from)\s+public\.(?:branch_stock|products|invoices|cash_transactions|bom_items)\b/i);
  expect(sql).toContain("stock_policy_unchanged");
  expect(sql).toContain("stock_hardening_backups_00562");
 });
});

