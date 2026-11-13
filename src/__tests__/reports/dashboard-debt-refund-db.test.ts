// Exercise the migration against an isolated Postgres-compatible database.
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const db = new PGlite();
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const branch = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const actor = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const other = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const cash = '11111111-1111-1111-1111-111111111111';
const settlement = '22222222-2222-2222-2222-222222222222';
const event = '33333333-3333-3333-3333-333333333333';
const ret = '44444444-4444-4444-4444-444444444444';

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select '${actor}'::uuid $$;
    create table public.test_permissions(code text primary key);
    insert into public.test_permissions values ('customers.view_debt'),('reports.dashboard');
    create function public.user_has_permission(uuid,text) returns boolean language sql stable as $$select exists(select 1 from public.test_permissions where code=$2)$$;
    create function public.can_read_branch_document_00567(uuid,uuid) returns boolean language sql stable as $$ select $2='${branch}'::uuid $$;
    create function public.user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$ select $2='${branch}'::uuid $$;
    create function public.assert_report_access(text,uuid) returns void language sql stable as $$select$$;
    create function private.report_expense_source_unresolved_v1() returns text language plpgsql stable as $$begin raise exception 'unresolved expense'; end$$;
    create table profiles(id uuid,tenant_id uuid,is_active boolean);
    insert into profiles values('${actor}','${tenant}',true);
    create table branches(id uuid,tenant_id uuid,branch_type text);
    insert into branches values('${branch}','${tenant}','warehouse');
    create table invoices(id uuid,tenant_id uuid,branch_id uuid,status text,deleted_at timestamptz,source text,ngay_chung_tu timestamptz,debt numeric);
    insert into invoices values
      ('55555555-5555-5555-5555-555555555555','${tenant}','${branch}','completed',null,'pos','2026-11-13 03:00Z',12000),
      ('66666666-6666-6666-6666-666666666666','${tenant}','${branch}','completed',null,'pos','2026-11-13 09:00Z',345),
      ('77777777-7777-7777-7777-777777777777','${tenant}','${branch}','draft',null,'pos','2026-11-13 09:00Z',999),
      ('88888888-8888-8888-8888-888888888888','${other}','${branch}','completed',null,'pos','2026-11-13 09:00Z',999);
    create table cash_transactions(id uuid,tenant_id uuid,branch_id uuid,type text,status text,created_at timestamptz,category text,amount numeric,reference_type text,reference_id uuid);
    create table management_finance_settlements(cash_transaction_id uuid,event_id uuid);
    create table management_finance_events(id uuid,tenant_id uuid);
    create table supplier_advances(tenant_id uuid,branch_id uuid,cash_transaction_id uuid);
    create table customer_advances(tenant_id uuid,branch_id uuid,cash_transaction_id uuid);
    create table party_advance_refunds(tenant_id uuid,branch_id uuid,cash_id uuid);
    create table purchase_orders(id uuid,tenant_id uuid,branch_id uuid);
    create table input_invoices(id uuid,tenant_id uuid,branch_id uuid);
    create table sales_returns(id uuid,tenant_id uuid,branch_id uuid);
    create table supplier_returns(id uuid,tenant_id uuid,branch_id uuid);
    create table internal_sales(id uuid,tenant_id uuid,from_branch_id uuid,to_branch_id uuid);
    create table internal_return_settlements(id uuid,event_id uuid,tenant_id uuid,cash_id uuid,kind text,amount numeric);
    create table internal_stock_return_events(id uuid,return_id uuid,action text);
    create table internal_stock_returns(id uuid,tenant_id uuid,to_branch_id uuid,status text);
    insert into cash_transactions values ('${cash}','${tenant}','${branch}','payment','completed','2026-11-11 03:15Z','Hoàn trả hàng nội bộ',735000,'internal_return_settlement','${settlement}');
    insert into internal_stock_returns values('${ret}','${tenant}','${branch}','received');
    insert into internal_stock_return_events values('${event}','${ret}','received');
    insert into internal_return_settlements values('${settlement}','${event}','${tenant}','${cash}','refund',735000);
  `);
  await db.exec(readFileSync(resolve('supabase/migrations/20261113124451_dashboard_debt_refund_source.sql'),'utf8'));
});
afterAll(async () => db.close());

describe('debt and internal-return report behavior', () => {
  it('returns current debt of completed invoices in the selected day and excludes other tenants and drafts', async () => {
    const { rows } = await db.query<{result: {amount:number,invoice_count:number,missing_count:number}}>(`select public.get_sales_day_invoice_receivable('${branch}','2026-11-13') as result`);
    expect(rows[0].result).toEqual({amount:12345,invoice_count:2,missing_count:0});
  });
  it('requires the debt permission even if a sales dashboard is allowed', async () => {
    await db.exec("delete from public.test_permissions where code='customers.view_debt'");
    await expect(db.query(`select public.get_sales_day_invoice_receivable('${branch}','2026-11-13')`)).rejects.toThrow('DASHBOARD_DEBT_PERMISSION_DENIED');
    await db.exec("insert into public.test_permissions values ('customers.view_debt')");
  });
  it('rejects access to a branch outside the signed-in user scope', async () => {
    await expect(db.query(`select public.get_sales_day_invoice_receivable('${other}','2026-11-13')`)).rejects.toThrow('DASHBOARD_BRANCH_DENIED');
  });
  it('flags an unknown invoice debt instead of claiming a complete balance', async () => {
    await db.exec(`insert into invoices values ('99999999-9999-9999-9999-999999999999','${tenant}','${branch}','completed',null,'pos','2026-11-13 10:00Z',null)`);
    const {rows} = await db.query<{result: {missing_count:number}}>(`select public.get_sales_day_invoice_receivable('${branch}','2026-11-13') as result`);
    expect(rows[0].result.missing_count).toBe(1);
    await db.exec("delete from invoices where id='99999999-9999-9999-9999-999999999999'");
  });
  it('does not treat a properly linked internal refund as operating expense', async () => {
    const {rows} = await db.query(`select * from private.report_cash_operating_expenses_v1('${tenant}','2026-11-01','2026-11-14','${branch}')`);
    expect(rows).toHaveLength(0);
  });
  it('still rejects a refund with mismatched evidence rather than silently dropping it', async () => {
    await db.exec(`update internal_return_settlements set amount=734999 where id='${settlement}'`);
    await expect(db.query(`select * from private.report_cash_operating_expenses_v1('${tenant}','2026-11-01','2026-11-14','${branch}')`)).rejects.toThrow('unresolved expense');
  });
});
