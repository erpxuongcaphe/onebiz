-- Read shared reference lists when the user can enter MKT; mutation remains global.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare r record;expression text;patched text;begin
 for r in select * from (values
  ('public.mkt_content_pillars','mkt_pillars_select'),
  ('public.mkt_content_pillar_angles','mkt_pillar_angles_select'),
  ('public.mkt_workflow_templates','mkt_templates_select')
 ) as x(tbl,policy) loop
  select pg_get_expr(polqual,polrelid) into expression from pg_policy where polrelid=to_regclass(r.tbl) and polname=r.policy;
  if expression is null or md5(expression)<>'a55a21a78dd38001ea3affe8c5fff73c' then raise exception 'MKT_SHARED_REFERENCE_BASELINE_CHANGED: %',r.policy;end if;
  patched:=replace(expression,'( SELECT user_has_permission(( SELECT auth.uid() AS uid), ''mkt.view''::text) AS user_has_permission)','( SELECT coalesce((public.mkt_get_my_context()->>''canView'')::boolean,false))');
  if patched=expression then raise exception 'MKT_SHARED_REFERENCE_SCOPE_CHANGED: %',r.policy;end if;
  execute format('alter policy %I on %s using (%s)',r.policy,r.tbl,patched);
 end loop;
end$$;
commit;
