-- Read only. Do not run the release migrations from this file.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
select current_database() as database_name, current_setting('server_version') as postgres_version;
select version,name from supabase_migrations.schema_migrations
 where version between '00532' and '00551' order by version;
select name,to_regprocedure(name) is not null as present,
 case when to_regprocedure(name) is not null then md5(pg_get_functiondef(to_regprocedure(name))) end as definition_hash
 from unnest(array[
 'public.ops_quality_execute(text,jsonb,uuid)',
 'public.ops_quality_execute_core(text,jsonb,uuid)',
 'public.ops_quality_read(uuid,text,text,jsonb)',
 'public.ops_quality_read_core(uuid,text,text,jsonb)',
 'public.ops_q_score(uuid,text)',
 'public.ops_q_rule_errors(jsonb,boolean)',
 'public.ops_q_reconcile(uuid,text)',
 'public.ops_q_business(uuid,text)',
 'public.ops_execute(text,jsonb,uuid)',
 'public._can_read_branch_inventory_00476(uuid,uuid,uuid)'
 ]) name;
select name,to_regclass('public.'||name) is not null as already_exists
 from unnest(array['ops_q_periods','ops_q_groups','ops_q_references']) name;
select c.relname,c.relrowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('ops_q_rules','ops_q_checks','ops_q_events','ops_q_settlements');
select table_name,column_name,data_type from information_schema.columns
 where table_schema='public' and table_name in ('ops_q_checks','ops_q_catalog')
 and column_name in ('run_id','kind','group_title','item_snapshot') order by table_name,column_name;
commit;
