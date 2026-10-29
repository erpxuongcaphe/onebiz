import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(resolve(process.argv[2])).href);
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let checks=0;
const check=(v,msg)=>{assert.ok(v,msg);checks++};
try {
 await db.exec(`
 create role anon; create role authenticated;
 create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
 create table branches(id uuid primary key,tenant_id uuid);
 create table products(id uuid primary key,tenant_id uuid,stock numeric);
 create table branch_stock(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,variant_id uuid,quantity numeric);
 create table stock_movements(id uuid primary key default gen_random_uuid(),tenant_id uuid,branch_id uuid,product_id uuid,type text,quantity numeric,reference_type text,reference_id uuid,note text,created_by uuid);
 create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,new_data jsonb);
 create table fixture_cost_events(source_reference_id uuid not null,quantity numeric,direction text);
 create table fixture_lot_sync(tenant_id uuid,branch_id uuid,product_id uuid);
 create table invoices(id uuid,total numeric,paid numeric);
 insert into invoices values('${id(90)}',42000,42000);
 create function user_has_permission(uuid,text) returns boolean language sql as $$select $1='${id(1)}'::uuid$$;
 create function user_has_branch_access(uuid,uuid) returns boolean language sql as $$select $2='${id(20)}'::uuid$$;
 create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$select jsonb_build_object('locked',coalesce(current_setting('test.locked',true),'false')='true')$$;
 create function increment_product_stock(uuid,numeric) returns void language sql as $$update products set stock=stock+$2 where id=$1$$;
 create function upsert_branch_stock(uuid,uuid,uuid,numeric) returns void language plpgsql as $$begin
 update branch_stock set quantity=quantity+$4 where tenant_id=$1 and branch_id=$2 and product_id=$3 and variant_id is null;
 if not found then insert into branch_stock(tenant_id,branch_id,product_id,quantity) values($1,$2,$3,$4);end if;end$$;
 create function _reconcile_product_lots_to_branch_00284(uuid,uuid,uuid,text,uuid,uuid,text) returns void language sql as $$insert into fixture_lot_sync values($1,$2,$3)$$;
 create function fixture_capture_cost() returns trigger language plpgsql as $$begin
 insert into fixture_cost_events values(new.reference_id,new.quantity,new.type);return new;end$$;
 create trigger capture_cost after insert on stock_movements for each row execute function fixture_capture_cost();
 insert into profiles values('${id(1)}','${id(10)}',true),('${id(2)}','${id(10)}',true);
 insert into branches values('${id(20)}','${id(10)}'),('${id(21)}','${id(99)}');
 insert into products values('${id(30)}','${id(10)}',10),('${id(31)}','${id(99)}',10),('${id(32)}','${id(10)}',1);
 insert into branch_stock(tenant_id,branch_id,product_id,quantity) values('${id(10)}','${id(20)}','${id(30)}',10);
 insert into branch_stock(tenant_id,branch_id,product_id,variant_id,quantity) values('${id(10)}','${id(20)}','${id(32)}','${id(80)}',1);
 select set_config('test.actor','${id(1)}',false);
 `);
 function extract(file,name){const s=readFileSync(file,'utf8');const start=s.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);return s.slice(start,s.indexOf('$$;',start)+3)}
 // Real mutation core and auth wrapper, with fixture-only stock/cost/lot storage.
 await db.exec(extract('supabase/migrations/00056_zero_drift_stock_hardening.sql','apply_manual_stock_movement_atomic').replace('public.apply_manual_stock_movement_atomic(','public._apply_manual_stock_movement_impl_00226('));
 await db.exec(extract('supabase/migrations/00246_harden_stock_document_rpcs.sql','apply_manual_stock_movement_atomic').replace('public.apply_manual_stock_movement_atomic(','public._apply_manual_stock_movement_auth_impl_00246('));
 // Preserve the deployed wrapper's lot synchronization contract.
 await db.exec(`create function apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb) returns jsonb language plpgsql set search_path=public as $$declare result jsonb;p uuid;begin
 result:=_apply_manual_stock_movement_auth_impl_00246($1,$2,$3,$4);
 for p in select distinct (x->>'product_id')::uuid from jsonb_array_elements($4) x loop
 perform _reconcile_product_lots_to_branch_00284('${id(10)}',$2,p,'manual_adjust',$2,auth.uid(),'fixture');end loop;return result;end$$;`);
 await db.exec(readFileSync('supabase/migrations/20261029170929_stock_adjustment_target_guard.sql','utf8'));
 const call=({request=id(40),branch=id(20),product=id(30),expected=10,target=8,reason='Fixture adjustment'}={})=>
 db.query('select adjust_stock_to_value_atomic($1,$2,$3,$4,$5,$6) result',[request,branch,product,expected,target,reason]);
 const balance=async()=>Number((await db.query('select quantity from branch_stock where product_id=$1',[id(30)])).rows[0].quantity);
 const rejected=async(args,pattern)=>{await assert.rejects(call(args),pattern);checks++};
 await call();check(await balance()===8,'decrease target applied');
 check((await db.query('select source_reference_id from fixture_cost_events')).rows[0].source_reference_id===id(40),'cost event has a nonnull source');
 check((await db.query('select count(*) n from fixture_lot_sync')).rows[0].n===1,'existing lot synchronizer called');
 check((await call()).rows[0].result.idempotent,'replay recognized before stale comparison');
 check(await balance()===8,'replay never subtracts twice');
 check((await db.query('select count(*) n from stock_movements')).rows[0].n===1,'only one movement');
 await rejected({target:7},/REQUEST_REUSED/);
 await rejected({expected:20,target:18},/REQUEST_REUSED/);
 await rejected({request:id(41),expected:10,target:12},/STOCK_TARGET_CHANGED/);
 check(await balance()===8,'concurrent sale/stale screen cannot change stock');
 await call({request:id(42),expected:8,target:12});check(await balance()===12,'increase target applied');
 await rejected({request:id(43),target:-1},/INVALID/);
 await rejected({request:id(43),target:'NaN'},/INVALID/);
 await rejected({request:id(43),target:'Infinity'},/INVALID/);
 await rejected({request:id(43),target:1.00001},/INVALID/);
 await rejected({request:id(43),reason:'  '},/INVALID/);
 await rejected({request:null},/INVALID/);
 await rejected({request:id(43),product:id(31)},/PRODUCT_DENIED/);
 await rejected({request:id(43),product:id(32),expected:1,target:0},/VARIANT_REQUIRES_CHECK/);
 await rejected({request:id(43),branch:id(21)},/DENIED/);
 await db.exec(`select set_config('test.actor','${id(2)}',false)`);
 await rejected({request:id(43),expected:12,target:10},/DENIED/);
 await db.exec(`select set_config('test.actor','',false)`);await rejected({},/DENIED/);
 await db.exec(`select set_config('test.actor','${id(1)}',false);select set_config('test.locked','true',false)`);
 await rejected({request:id(43),expected:12,target:10},/INVENTORY_LOCKED/);
 check(await balance()===12,'failed operations rolled back');
 await db.exec(`select set_config('test.locked','false',false)`);
 await call({request:id(44),expected:12,target:12});
 check((await db.query('select count(*) n from stock_movements')).rows[0].n===2,'unchanged target produces no movement');
 check((await db.query('select total=42000 and paid=42000 ok from invoices')).rows[0].ok,'existing invoice money untouched');
 check((await db.query("select not has_function_privilege('anon','adjust_stock_to_value_atomic(uuid,uuid,uuid,numeric,numeric,text)','execute') ok")).rows[0].ok,'anonymous call denied');
 check(Number((await db.query('select stock from products where id=$1',[id(30)])).rows[0].stock)===12,'product snapshot matches branch');
 console.log(`PASS ${checks} target adjustment checks. Real auth/mutation core; cost/lot storage fixtures, no production calls.`);
}finally{await db.close()}
