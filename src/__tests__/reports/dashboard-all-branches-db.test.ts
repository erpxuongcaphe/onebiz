import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const db = new PGlite();
const actor='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const tenant='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const branch='cccccccc-cccc-cccc-cccc-cccccccccccc';
const other='dddddddd-dddd-dddd-dddd-dddddddddddd';
beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
    create table permissions(code text primary key);
    insert into permissions values ('reports.view_all_branches'),('reports.dashboard'),('pos_fnb.view_sales_summary'),('reports.analytics'),('reports.view_detail');
    create function public.user_has_permission(uuid,text) returns boolean language sql as $$select exists(select 1 from public.permissions where code=$2)$$;
    create function public.assert_report_access(text,uuid) returns void language plpgsql as $$begin if not public.user_has_permission(auth.uid(),$1) then raise exception 'DENIED'; end if; end$$;
    create function public._can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql as $$select $3='${branch}'::uuid$$;
    create function public.get_operational_sales_dashboard(uuid,date,date,text) returns jsonb language sql stable as $$select '{"sales":300}'::jsonb$$;
    create table profiles(id uuid,tenant_id uuid,is_active boolean);
    create table branches(id uuid,tenant_id uuid,branch_type text);
    create table invoices(id uuid,tenant_id uuid,branch_id uuid,status text,deleted_at timestamptz,source text,ngay_chung_tu timestamptz,total numeric,discount_amount numeric);
    create table sales_returns(id uuid,tenant_id uuid,branch_id uuid,invoice_id uuid,status text,created_at timestamptz,total numeric);
    create table categories(id uuid,tenant_id uuid,name text);
    create table products(id uuid,tenant_id uuid,code text,category_id uuid);
    create table invoice_items(id uuid,invoice_id uuid,product_id uuid,product_name text,unit text,quantity numeric,total numeric,discount numeric);
    insert into profiles values('${actor}','${tenant}',true);
    insert into branches values('${branch}','${tenant}','store'),('${other}','${tenant}','store');
    insert into invoices values
      ('10000000-0000-0000-0000-000000000001','${tenant}','${branch}','completed',null,'internal','2020-01-01 02:00Z',700,0),
      ('10000000-0000-0000-0000-000000000002','${tenant}','${branch}','completed',null,'pos','2020-01-01 03:00Z',300,20),
      ('10000000-0000-0000-0000-000000000003','${tenant}','${branch}','draft',null,'internal','2020-01-01 03:00Z',999,0),
      ('10000000-0000-0000-0000-000000000004','${tenant}','${other}','completed',null,'pos','2020-01-01 03:00Z',999,0);
    insert into sales_returns values ('20000000-0000-0000-0000-000000000001','${tenant}','${branch}','10000000-0000-0000-0000-000000000001','completed','2020-01-01 04:00Z',100);
    insert into categories values ('30000000-0000-0000-0000-000000000001','${tenant}','Đồ uống');
    insert into products values ('40000000-0000-0000-0000-000000000001','${tenant}','SKU-TEST','30000000-0000-0000-0000-000000000001');
    insert into invoice_items values
      ('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Nội bộ','Ly',1,700,0),
      ('50000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Bán lẻ','Ly',2,320,0),
      ('50000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000001','Ngoài quyền','Ly',1,999,0);
  `);
  await db.exec(readFileSync(resolve('supabase/migrations/20261113135122_dashboard_all_branches_sales.sql'),'utf8'));
  await db.exec(readFileSync(resolve('supabase/migrations/20261113135220_dashboard_product_lines.sql'),'utf8'));
});
afterAll(async () => db.close());
describe('all-branch dashboard data', () => {
  it('nets internal sales and completed returns on their actual dates', async () => {
    const {rows}=await db.query<{result:{internal_net:number}}>("select public.get_dashboard_internal_sales('2020-01-01') result");
    expect(rows[0].result.internal_net).toBe(600);
  });
  it('returns chain and internal totals together for reconciliation', async () => {
    const {rows}=await db.query<{result:{sales:number,internal_net:number}}>("select public.get_dashboard_all_branch_day('2020-01-01') result");
    expect(rows[0].result).toEqual({sales:300,internal_net:600});
  });
  it('requires all branch permission before internal totals', async () => {
    await db.exec("delete from permissions where code='reports.view_all_branches'");
    await expect(db.query("select public.get_dashboard_internal_sales('2020-01-01')")).rejects.toThrow('DASHBOARD_ALL_BRANCHES_DENIED');
    await db.exec("insert into permissions values('reports.view_all_branches')");
  });
  it('excludes internal and inaccessible branches from consolidated product lines', async () => {
    const {rows}=await db.query<{product_name:string}>("select product_name from public.get_dashboard_product_lines('2019-12-31T17:00Z','2020-01-01T17:00Z')");
    expect(rows.map(row=>row.product_name)).toEqual(['Bán lẻ']);
  });
  it('includes internal when a permitted branch is selected', async () => {
    const {rows}=await db.query<{product_name:string}>(`select product_name from public.get_dashboard_product_lines('2019-12-31T17:00Z','2020-01-01T17:00Z','${branch}')`);
    expect(rows.map(row=>row.product_name)).toEqual(['Nội bộ','Bán lẻ']);
  });
  it('pages without dropping rows at the 1000-row boundary', async () => {
    await db.exec(`insert into invoice_items select ('60000000-0000-0000-0000-'||lpad(to_hex(n),12,'0'))::uuid,
      '10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Test','Ly',1,1,0
      from generate_series(1,1001) n`);
    const first=await db.query<{id:string}>("select id from public.get_dashboard_product_lines('2019-12-31T17:00Z','2020-01-01T17:00Z')");
    expect(first.rows).toHaveLength(1000);
    const second=await db.query<{id:string}>(`select id from public.get_dashboard_product_lines('2019-12-31T17:00Z','2020-01-01T17:00Z',null,'${first.rows[999].id}')`);
    expect(second.rows).toHaveLength(2);
    expect(new Set([...first.rows,...second.rows].map(r=>r.id)).size).toBe(1002);
  });
  it('denies product detail without report permission', async () => {
    await db.exec("delete from permissions where code='reports.view_detail'");
    await expect(db.query("select * from public.get_dashboard_product_lines('2019-12-31T17:00Z','2020-01-01T17:00Z')")).rejects.toThrow('DENIED');
    await db.exec("insert into permissions values('reports.view_detail')");
  });
});
