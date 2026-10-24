-- Disposable database only; run with psql -v ON_ERROR_STOP=1.
begin;
create schema if not exists auth;
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin;end if;
end;$$;
create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth,public to authenticated,anon;
create table tenants(id uuid primary key);
create table profiles(id uuid primary key,tenant_id uuid,is_active boolean);
create table invoices(id integer primary key,total numeric);
insert into tenants values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into profiles values('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001',true),('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000002',true),('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000001',false);
insert into invoices values(1,50000);
\ir ../migrations/202610240001_invoice_display_account_preferences.sql
\ir ../migrations/202610240001_invoice_display_account_preferences.sql
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',true);
do $$declare t uuid='00000000-0000-0000-0000-000000000001';u uuid='00000000-0000-0000-0000-000000000011';r jsonb;begin
 assert get_invoice_display_preferences_20261024(t,u) is null,'new account starts empty';
 r=save_invoice_display_preferences_20261024(t,u,'{"splitOptions":true,"detailVisibility":{"Size":false},"listColumns":{"date":false}}',true);
 assert r->'settings'->'splitOptions'='true'::jsonb;
 r=save_invoice_display_preferences_20261024(t,u,'{"splitOptions":false}',true);
 assert r->'settings'->'splitOptions'='true'::jsonb,'second device initialization cannot overwrite';
 r=save_invoice_display_preferences_20261024(t,u,'{"detailVisibility":{"Mức đá":false},"listColumns":{"customerName":false}}');
 assert r->'settings'->'detailVisibility'='{"Size":false,"Mức đá":false}'::jsonb,'independent detail patches merge';
 assert r->'settings'->'listColumns'='{"date":false,"customerName":false}'::jsonb,'independent list patches merge';
 assert (r->>'revision')::integer=2;
 begin perform get_invoice_display_preferences_20261024(t,'00000000-0000-0000-0000-000000000012');raise exception 'forged user accepted';exception when insufficient_privilege then null;end;
 begin perform save_invoice_display_preferences_20261024('00000000-0000-0000-0000-000000000002',u,'{}');raise exception 'forged tenant accepted';exception when insufficient_privilege then null;end;
 begin perform * from invoice_display_preferences;raise exception 'direct table access accepted';exception when insufficient_privilege then null;end;
 begin perform save_invoice_display_preferences_20261024(t,u,'{"role":"admin"}');raise exception 'unknown key accepted';exception when raise_exception then if sqlerrm<>'DISPLAY_PREFERENCES_INVALID' then raise;end if;end;
 begin perform save_invoice_display_preferences_20261024(t,u,'{"detailVisibility":{"stock":true}}');raise exception 'unknown detail accepted';exception when raise_exception then if sqlerrm<>'DISPLAY_PREFERENCES_INVALID' then raise;end if;end;
 begin perform save_invoice_display_preferences_20261024(t,u,'{"splitOptions":"true"}');raise exception 'wrong type accepted';exception when raise_exception then if sqlerrm<>'DISPLAY_PREFERENCES_INVALID' then raise;end if;end;
end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',true);
do $$begin assert get_invoice_display_preferences_20261024('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012') is null,'other account is isolated';end;$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000014',true);
do $$begin
 begin perform save_invoice_display_preferences_20261024('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000014','{}');raise exception 'inactive user accepted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
set local role anon;
do $$begin
 begin perform get_invoice_display_preferences_20261024('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011');raise exception 'anon accepted';exception when insufficient_privilege then null;end;
end;$$;
reset role;
do $$begin assert (select count(*)=1 from invoices);assert (select total=50000 from invoices where id=1),'invoice unchanged';assert (select count(*)=1 from invoice_display_preferences),'only intended preference created';end;$$;
rollback;
