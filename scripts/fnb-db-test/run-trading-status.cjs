const fs=require('fs');
const {PGlite}=require(process.env.FNB_PGLITE_DIR || '@electric-sql/pglite');
(async()=>{const db=new PGlite();try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create table profiles(id uuid primary key,tenant_id uuid,is_active boolean,can_edit boolean);
 create function user_has_permission(uuid,text) returns boolean language sql as $$select can_edit from profiles where id=$1$$;
 create table products(id uuid primary key,tenant_id uuid,code text,name text,is_active boolean,stock numeric,updated_at timestamptz);
 create table audit_log(tenant_id uuid,user_id uuid,action text,entity_type text,entity_id uuid,old_data jsonb,new_data jsonb);
 insert into profiles values('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true,true),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001',true,false);
 insert into products values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','A','A',true,17,now()),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','B','B',false,-2,now()),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','C','C',true,10,now());`);
 await db.exec(fs.readFileSync('supabase/migrations/00552_product_trading_status.sql','utf8'));
 await db.exec(`select set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
 do $$declare n int; begin
 n:=set_product_trading_status_00552(array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid],false);
 if n<>1 then raise exception 'mixed selection count'; end if;
 n:=set_product_trading_status_00552(array['20000000-0000-0000-0000-000000000001'::uuid],false);
 if n<>0 then raise exception 'not idempotent'; end if;
 begin perform set_product_trading_status_00552(array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000003'::uuid],true);
 raise exception 'cross-tenant accepted'; exception when insufficient_privilege then null; end;
 if exists(select 1 from products where id='20000000-0000-0000-0000-000000000001' and is_active) then raise exception 'partial mutation'; end if;
 n:=set_product_trading_status_00552(array['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid],true);
 if n<>2 or (select stock from products where code='A')<>17 or (select stock from products where code='B')<>-2 then raise exception 'stock changed'; end if;
 if (select count(*) from audit_log)<>3 then raise exception 'audit missing'; end if;
 perform set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
 begin perform set_product_trading_status_00552(array['20000000-0000-0000-0000-000000000001'::uuid],false);
 raise exception 'permission bypass'; exception when insufficient_privilege then null; end;
 end $$;`);
 console.log('PASS: mixed states, positive/negative stock unchanged, idempotency, tenant isolation, all-or-nothing, edit permission, audit');
} finally {await db.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
