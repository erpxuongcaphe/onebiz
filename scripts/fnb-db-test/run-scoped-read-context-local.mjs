import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db=new PGlite();
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,branch_id uuid,role text,is_active boolean);
 create table user_branches(user_id uuid,branch_id uuid);
 create table permissions(user_id uuid,code text);
 create function get_user_tenant_id() returns uuid language sql stable security definer set search_path='' as $$select tenant_id from public.profiles where id=auth.uid()$$;
 create function user_has_permission(uuid,text) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.permissions where user_id=$1 and code=$2)$$;
 create function user_has_branch_access(uuid,uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=$1 and (p.role='owner' or p.branch_id=$2 or exists(select 1 from public.user_branches ub where ub.user_id=$1 and ub.branch_id=$2)))$$;
 create function _can_read_branch_inventory_00476(uuid,uuid,uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles profile where profile.id=$1 and profile.tenant_id=$2 and coalesce(profile.is_active,true)
 and (public.user_has_branch_access($1,$3) or public.user_has_permission($1,'reports.view_all_branches')))$$;
 create table invoices(id uuid primary key,tenant_id uuid,branch_id uuid);
 create table invoice_items(id uuid primary key,invoice_id uuid,product_id uuid,product_name text,unit text,quantity numeric,unit_price numeric,discount numeric,total numeric,vat_rate numeric,vat_amount numeric,returned_qty numeric,unit_cost numeric,note text,variant_id uuid,fnb_gross_amount numeric,transaction_quantity numeric,transaction_unit text,transaction_unit_price numeric,conversion_factor numeric);
 create table stock_movements(id uuid primary key,tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid,created_at timestamptz,unit_cost numeric,unit_price numeric);
 grant usage on schema public,auth to authenticated;
 insert into profiles values
 ('${id(101)}','${id(1)}','${id(11)}','staff',true),
 ('${id(102)}','${id(1)}','${id(11)}','owner',true),
 ('${id(103)}','${id(1)}','${id(11)}','staff',true),
 ('${id(104)}','${id(1)}','${id(11)}','owner',false),
 ('${id(105)}','${id(2)}','${id(21)}','owner',true);
 insert into user_branches values ('${id(101)}','${id(12)}'),('${id(101)}','${id(999)}');
 insert into permissions values ('${id(103)}','reports.view_all_branches'),('${id(102)}','products.view_cost');
 insert into invoices values
 ('${id(31)}','${id(1)}','${id(11)}'),('${id(32)}','${id(1)}','${id(12)}'),
 ('${id(33)}','${id(1)}',null),('${id(34)}','${id(1)}','${id(999)}'),('${id(35)}','${id(2)}','${id(21)}');
 insert into invoice_items(id,invoice_id,unit_cost,total) select id,id,123,456 from invoices;
 insert into stock_movements(id,tenant_id,branch_id,unit_cost,unit_price) select id,tenant_id,branch_id,123,456 from invoices;
 alter table invoices enable row level security;alter table invoice_items enable row level security;alter table stock_movements enable row level security;`);
 await db.exec(fs.readFileSync('supabase/tests/fixtures/scoped-read-before-20261029.sql','utf8'));
 await db.exec('grant select on invoice_items_scoped,stock_movements_scoped to authenticated;');
 const actors=[101,102,103,104,105,null];
 const read=async actor=>{
  await db.exec(`reset role;select set_config('test.actor','${actor===null?'':id(actor)}',false);set role authenticated;`);
  return {items:(await db.query('select * from invoice_items_scoped order by id')).rows,stock:(await db.query('select * from stock_movements_scoped order by id')).rows};
 };
 const before=new Map();
 for(const actor of actors) before.set(actor,await read(actor));
 await db.exec('reset role;');
 const migration=fs.readFileSync('supabase/migrations/20261029042252_scoped_read_request_context.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 for(const actor of actors) assert.deepEqual(await read(actor),before.get(actor),'changed scope/cost for actor '+actor);
 assert.equal(before.get(101).items.length,3,'assigned, extra and orphan-linked branch access retained');
 assert.equal(before.get(102).items.length,4,'owner retains null branch');
 assert.equal(before.get(103).items.length,4,'explicit all-branch permission retained');
 assert.equal(before.get(104).items.length,0,'inactive owner denied');
 assert.equal(before.get(null).items.length,0,'anonymous denied');
 assert.equal(before.get(105).items.length,1,'foreign tenant isolated');
 assert.equal(Number(before.get(101).items[0].unit_cost),0,'cost stays redacted');
 assert.equal(Number(before.get(102).items[0].unit_cost),123,'explicit cost permission retained');
 await db.exec(`reset role;delete from user_branches where user_id='${id(101)}';insert into permissions values('${id(101)}','products.view_cost');`);
 const updated=await read(101);assert.equal(updated.items.length,1,'scope refreshes next request');assert.equal(Number(updated.items[0].unit_cost),123,'permission refreshes next request');
 await db.exec('reset role;');
 const options=(await db.query("select relname,reloptions from pg_class where relname in ('invoice_items_scoped','stock_movements_scoped')")).rows;
 assert(options.every(r=>r.reloptions.includes('security_barrier=true')));
 console.log('PASS: equivalent rows/costs for all roles, branch scopes, null/orphan branches, foreign tenant, live permission changes, idempotence and security barrier.');
} catch(error) {console.error(error.message,error.where??'');process.exitCode=1;} finally {await db.close();}
