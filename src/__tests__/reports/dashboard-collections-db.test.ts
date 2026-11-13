import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid $$;
    create table profiles(id uuid, tenant_id uuid, is_active boolean);
    insert into profiles values(auth.uid(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',true);
    create function public.get_operational_sales_dashboard(uuid,date,date,text) returns jsonb language plpgsql as $$
      begin if $1 = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid then raise exception 'DENIED'; end if; return '{}'::jsonb; end $$;
    create table invoices(id uuid, tenant_id uuid, branch_id uuid, source text);
    create table sales_returns(id uuid, tenant_id uuid, branch_id uuid, invoice_id uuid);
    create table cash_transactions(tenant_id uuid, branch_id uuid, reference_type text, reference_id uuid, type text, amount numeric, status text, transaction_date date, payment_method text);
    insert into invoices values
      ('10000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','internal'),
      ('10000000-0000-0000-0000-000000000002','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','retail');
    insert into sales_returns values('20000000-0000-0000-0000-000000000001','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','10000000-0000-0000-0000-000000000001');
    insert into cash_transactions values
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','invoice','10000000-0000-0000-0000-000000000001','receipt',350,'completed','2026-11-13','cash'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','sales_return','20000000-0000-0000-0000-000000000001','payment',50,'completed','2026-11-13','cash'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','invoice','10000000-0000-0000-0000-000000000002','receipt',400,'completed','2026-11-13','transfer'),
      ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','invoice','10000000-0000-0000-0000-000000000002','receipt',999,'completed','2026-11-12','cash');
  `);
  await db.exec(readFileSync(resolve("supabase/migrations/20261113235900_dashboard_internal_collections.sql"),"utf8"));
});
afterAll(async () => db.close());
describe("collections reconciliation", () => {
  it("separates internal, external, refund and method for branch and all", async () => {
    for (const scope of ["'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'", "null"]) {
      const result = await db.query<{data: {internal: {net:number; received:number; refunded:number; methods: {cash:number}}; external:{net:number}; total:{net:number}}}>(`select public.get_dashboard_collection_reconciliation(${scope},'2026-11-13') data`);
      expect(result.rows[0].data.internal).toMatchObject({net:300,received:350,refunded:50,methods:{cash:300}});
      expect(result.rows[0].data.external.net).toBe(400);
      expect(result.rows[0].data.total.net).toBe(700);
    }
  });
  it("propagates branch authorization failures", async () => {
    await expect(db.query("select public.get_dashboard_collection_reconciliation('dddddddd-dddd-dddd-dddd-dddddddddddd','2026-11-13')")).rejects.toThrow("DENIED");
  });
});
