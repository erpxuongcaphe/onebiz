begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local search_path = public;

-- Legacy inventory readers keep their existing access until a production
-- view exception is configured. Once configured, apply it to every row.
create function public._staff_production_row_visible(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.user_branch_permission_overrides o
    where o.user_id = auth.uid() and o.permission_code = 'production.view'
  ) or public._staff_permission_at_scope(auth.uid(), 'production.view', p_branch)
$$;

create function public._staff_my_production_view(p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when p_branch is null
    then public._staff_permission_any_branch(auth.uid(), 'production.view')
    else public._staff_permission_at_scope(auth.uid(), 'production.view', p_branch)
  end
$$;

revoke all on function public._staff_production_row_visible(uuid),
  public._staff_my_production_view(uuid) from public, anon;
grant execute on function public._staff_production_row_visible(uuid),
  public._staff_my_production_view(uuid) to authenticated;

do $migration$
declare
  item record;
  source text;
  patched text;
  anchor text;
  old_acl text;
  old_owner oid;
  old_options text[];
begin
  for item in select * from (values
    ('production_orders_scoped', 't'),
    ('production_order_materials_scoped', 'o')
  ) as views(name, row_alias) loop
    select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions
     into source,old_acl,old_owner,old_options from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relname=item.name and c.relkind='v';
    anchor := format('_can_read_branch_inventory_00476(auth.uid(), %1$s.tenant_id, %1$s.branch_id)', item.row_alias);
    if source is null or position(anchor in source) = 0 then
      raise exception 'STAFF_PRODUCTION_VIEW_CHANGED: %', item.name;
    end if;
    -- Keep the original projection, relationship columns and cost mask.
    patched := replace(source, anchor,
      format('(%s and public._staff_production_row_visible(%s.branch_id))', anchor, item.row_alias));
    execute format('create or replace view public.%I %s as %s',item.name,
      case when old_options is null then '' else 'with ('||array_to_string(old_options,',')||')' end,patched);
    if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=item.name
       and (c.relacl::text is distinct from old_acl or c.relowner<>old_owner or c.reloptions is distinct from old_options)) then
      raise exception 'STAFF_PRODUCTION_VIEW_METADATA_CHANGED: %',item.name;
    end if;
  end loop;

  source := pg_get_functiondef('public.get_production_order_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric,uuid)'::regprocedure);
  anchor := 'public.user_has_permission(v_actor,''production.view'')';
  if position(anchor in source) = 0 then
    raise exception 'STAFF_PRODUCTION_LIST_CHANGED';
  end if;
  execute replace(source, anchor, 'public._staff_my_production_view(p_branch_id)');

  source := pg_get_functiondef('public._production_used_adjustment(uuid,timestamptz,numeric,jsonb,text,boolean,uuid,text)'::regprocedure);
  anchor := 'user_has_permission(actor,''production.view'')';
  if position(anchor in source) = 0 then
    raise exception 'STAFF_PRODUCTION_ADJUSTMENT_VIEW_CHANGED';
  end if;
  execute replace(source, anchor, '_staff_permission_at_scope(actor,''production.view'',po.branch_id)');
end
$migration$;

alter policy production_used_adjustments_read on public.production_used_adjustments
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.tenant_id = production_used_adjustments.tenant_id
      and coalesce(p.is_active, true)
  )
  and public.user_has_branch_access(auth.uid(), branch_id)
  and public._staff_my_production_view(branch_id)
);

insert into public.staff_branch_permission_catalog values ('production.view', 1);
commit;
