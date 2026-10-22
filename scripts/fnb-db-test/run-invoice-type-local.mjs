import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite(); const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
let checks=0;
async function equal(sql,expected,label){assert.deepEqual((await db.query(sql)).rows[0].v,expected,label);checks++;console.log('PASS '+label);}
async function denied(sql,message){await assert.rejects(db.query(sql),e=>e.message.includes(message));checks++;}
const sum=(mode,branch=2,statuses="ARRAY['completed']",search='null')=>`select so_dong_theo_bo_loc::int v from get_invoice_list_summary('${id(branch)}',null,null,${statuses},${search},'all','${mode}')`;
try {
await db.exec(`create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
create function get_user_tenant_id() returns uuid language sql stable as $$select '${id(1)}'::uuid$$;
create function user_has_permission(uuid,text) returns boolean language sql stable as $$select case when $2='pos_fnb.view_sales_summary' then coalesce(current_setting('test.summary',true),'yes')='yes' else false end$$;
create function user_has_branch_access(uuid,uuid) returns boolean language sql stable as $$select $2='${id(2)}'::uuid$$;
create function get_user_accessible_branches(uuid) returns table(branch_id uuid) language sql stable as $$select '${id(2)}'::uuid$$;
create table profiles(id uuid,tenant_id uuid,is_active boolean);
create table branches(id uuid,tenant_id uuid,branch_type text);
create table invoices(id uuid,tenant_id uuid,branch_id uuid,source text,order_code text,code text,customer_name text,status text,total numeric,discount_amount numeric,promotion_discount numeric,deleted_at timestamptz,issued_at timestamptz,created_at timestamptz);
create table shipping_orders(invoice_id uuid,tenant_id uuid);
create table kitchen_orders(invoice_id uuid,tenant_id uuid,branch_id uuid,order_type text);
insert into profiles values('${id(7)}','${id(1)}',true);
insert into branches values('${id(2)}','${id(1)}','store'),('${id(3)}','${id(1)}','store');
select set_config('test.actor','${id(7)}',false);`);
const base=fs.readFileSync('supabase/migrations/00342_invoice_list_only_sales_documents.sql','utf8');
const start=base.indexOf('CREATE OR REPLACE FUNCTION public.get_invoice_list_summary(');
const end=base.indexOf('$$;',base.indexOf('AS $$',start)+5);
assert(end>start);await db.exec(base.slice(start,end+3));
const permissions=fs.readFileSync('supabase/migrations/202610200006_fnb_sales_summary_permission.sql','utf8');
await db.exec(permissions.slice(permissions.indexOf('do $guard$')));
const migration=fs.readFileSync('supabase/migrations/202610220003_fnb_invoice_type_filter.sql','utf8');
await db.exec(migration);await db.exec(migration); // safe replay
for (let n=10;n<=16;n++)await db.exec(`insert into invoices values('${id(n)}','${id(1)}','${id(2)}','${n===16?'retail':'fnb'}',null,'HD${n}','Khách ${n}','${n===14?'cancelled':'completed'}',100,0,0,null,null,'2026-10-22T02:00:00Z')`);
for (const [n,type] of [[10,'dine_in'],[11,'takeaway'],[12,'delivery'],[14,'delivery'],[16,'delivery']])await db.exec(`insert into kitchen_orders values('${id(n)}','${id(1)}','${id(2)}','${type}')`);
await db.exec(`insert into kitchen_orders values('${id(12)}','${id(1)}','${id(2)}','delivery');
insert into kitchen_orders values('${id(13)}','${id(99)}','${id(2)}','delivery');
insert into kitchen_orders values('${id(15)}','${id(1)}','${id(3)}','delivery');
insert into shipping_orders values('${id(16)}','${id(1)}');`);
await equal(sum('fnb_dine_in'),1,'dine-in classification');
await equal(sum('fnb_takeaway'),1,'takeaway classification');
await equal(sum('fnb_delivery'),1,'delivery without shipment; duplicate kitchen rows count once');
await equal(`select gia_tri_hoan_thanh::int v from get_invoice_list_summary('${id(2)}',null,null,null,null,'all','fnb_delivery')`,100,'totals not multiplied and cancelled value excluded');
await equal(sum('fnb_delivery',2,"ARRAY['cancelled']"),1,'cancelled status kept within same form');
await equal(sum('fnb_delivery',2,"ARRAY['completed']","'HD11'"),0,'search composes with form');
await equal(sum('all'),6,'all retains unknown history and Retail');
await equal(sum('delivery'),1,'legacy Retail shipment filter unchanged');
await equal(sum('no_delivery'),5,'legacy non-shipment filter unchanged');
await equal(`select so_dong_theo_bo_loc::int v from get_invoice_list_summary('${id(2)}','2026-10-23',null,ARRAY['completed'],null,'all','fnb_delivery')`,0,'document date composes with form');
await denied(sum('fnb_delivery',3),'KPI_BRANCH_DENIED');
await db.exec(`select set_config('test.summary','no',false)`);await denied(sum('fnb_delivery'),'FNB_SALES_SUMMARY_PERMISSION_DENIED');
await db.exec(`select set_config('test.summary','yes',false);select set_config('test.actor','',false)`);await denied(sum('fnb_delivery'),'KPI_AUTH_REQUIRED');
console.log(checks+' PostgreSQL invoice-type checks passed');
}finally{await db.close();}
