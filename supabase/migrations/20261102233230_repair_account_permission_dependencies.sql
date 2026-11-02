-- ALTER FUNCTION RENAME retains its OID: stored views/policies still call the
-- now-private implementation. Reparse only those expressions against the public
-- permission wrapper; preserve view OIDs, grants, options and policy scope.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
set local search_path = public, pg_catalog;
do $repair$
declare item record; expression text; statement text;
begin
  for item in
    select v.schemaname, v.viewname, v.definition, c.reloptions from pg_views v
    join pg_namespace n on n.nspname=v.schemaname
    join pg_class c on c.relnamespace=n.oid and c.relname=v.viewname and c.relkind='v'
    where v.schemaname = 'public' and
      (definition like '%user_has_permission_before_account_hierarchy(%'
       or definition like '%get_user_effective_permissions_before_account_hierarchy(%')
  loop
    expression := replace(replace(item.definition,
      'user_has_permission_before_account_hierarchy(', 'user_has_permission('),
      'get_user_effective_permissions_before_account_hierarchy(', 'get_user_effective_permissions(');
    execute format('create or replace view %I.%I %s as %s', item.schemaname, item.viewname,
      case when cardinality(item.reloptions)>0 then 'with ('||array_to_string(item.reloptions,',')||')' else '' end,
      expression);
  end loop;
  for item in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public' and
      (coalesce(qual,'') || coalesce(with_check,'')) like '%before_account_hierarchy(%'
  loop
    statement := format('alter policy %I on %I.%I', item.policyname, item.schemaname, item.tablename);
    if item.qual is not null then
      expression := replace(replace(item.qual,
        'user_has_permission_before_account_hierarchy(', 'user_has_permission('),
        'get_user_effective_permissions_before_account_hierarchy(', 'get_user_effective_permissions(');
      statement := statement || format(' using (%s)', expression);
    end if;
    if item.with_check is not null then
      expression := replace(replace(item.with_check,
        'user_has_permission_before_account_hierarchy(', 'user_has_permission('),
        'get_user_effective_permissions_before_account_hierarchy(', 'get_user_effective_permissions(');
      statement := statement || format(' with check (%s)', expression);
    end if;
    execute statement;
  end loop;
  if exists (
    select 1 from pg_depend d
    where d.refobjid in (
      'public.user_has_permission_before_account_hierarchy(uuid,text)'::regprocedure,
      'public.get_user_effective_permissions_before_account_hierarchy(uuid)'::regprocedure)
    and d.classid in ('pg_rewrite'::regclass, 'pg_policy'::regclass)
  ) then raise exception 'ACCOUNT_PERMISSION_STORED_DEPENDENCY_REMAINS'; end if;
end $repair$;
commit;
