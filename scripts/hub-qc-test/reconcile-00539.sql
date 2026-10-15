-- Metadata reconciliation only. Do not replay the installed Hub DDL.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';
do $guard$
begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='00539')
 or not exists(select 1 from supabase_migrations.schema_migrations
   where version='00537' and name='operations_quality_acceptance_fixes')
 or strpos(pg_get_functiondef('public.ops_quality_execute_core(text,jsonb,uuid)'::regprocedure),'catalogIds')=0
 then raise exception 'Hub migration metadata baseline changed; abort'; end if;
 update supabase_migrations.schema_migrations set version='00539'
 where version='00537' and name='operations_quality_acceptance_fixes';
end $guard$;
commit;
select version,name from supabase_migrations.schema_migrations where version between '00537' and '00539' order by version;
