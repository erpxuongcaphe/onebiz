-- Draft catalog only. Does not alter stock, prices, BOM, or transaction RPCs.
begin;

create table public.fnb_supply_catalog (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, product_id)
);
create table public.fnb_supply_catalog_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  action text not null check (action in ('add', 'remove')),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.fnb_supply_catalog_audit(tenant_id, branch_id, created_at desc);
alter table public.fnb_supply_catalog enable row level security;
alter table public.fnb_supply_catalog_audit enable row level security;
create policy fnb_supply_catalog_read on public.fnb_supply_catalog for select to authenticated
using (tenant_id = public.get_user_tenant_id()
  and public.user_has_permission(auth.uid(), 'products.view')
  and public.user_has_branch_access(auth.uid(), branch_id));
create policy fnb_supply_catalog_audit_read on public.fnb_supply_catalog_audit for select to authenticated
using (tenant_id = public.get_user_tenant_id()
  and public.user_has_permission(auth.uid(), 'products.edit')
  and public.user_has_permission(auth.uid(), 'system.manage_branches')
  and public.user_has_branch_access(auth.uid(), branch_id));
revoke all on public.fnb_supply_catalog, public.fnb_supply_catalog_audit from public, anon, authenticated;
grant select on public.fnb_supply_catalog, public.fnb_supply_catalog_audit to authenticated;

create function public.save_fnb_supply_catalog(
  p_product_ids uuid[], p_branch_ids uuid[], p_action text
) returns integer language plpgsql security definer set search_path = public
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_products uuid[];
  v_branches uuid[];
  v_count integer;
begin
  select tenant_id into v_tenant from public.profiles where id = v_actor and is_active;
  if v_tenant is null or not public.user_has_permission(v_actor, 'products.edit')
    or not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception using errcode = '42501', message = 'FNB_SUPPLY_PERMISSION_DENIED';
  end if;
  if p_action is null or p_action not in ('add', 'remove') then
    raise exception 'FNB_SUPPLY_ACTION_INVALID';
  end if;
  if coalesce(cardinality(p_product_ids), 0) not between 1 and 200
    or coalesce(cardinality(p_branch_ids), 0) not between 1 and 100
    or array_position(p_product_ids, null) is not null
    or array_position(p_branch_ids, null) is not null then
    raise exception 'FNB_SUPPLY_SELECTION_INVALID';
  end if;
  select array_agg(distinct x) into v_products from unnest(p_product_ids) x;
  select array_agg(distinct x) into v_branches from unnest(p_branch_ids) x;
  -- Serialize additive/removal requests without replacing another user's list.
  perform pg_advisory_xact_lock(hashtextextended('fnb-supply:' || v_tenant::text, 0));
  if (select count(*) from public.branches b where b.id = any(v_branches)
    and b.tenant_id = v_tenant and (p_action = 'remove' or b.is_active)
    and public.user_has_branch_access(v_actor, b.id)) <> cardinality(v_branches) then
    raise exception using errcode = '42501', message = 'FNB_SUPPLY_BRANCH_DENIED';
  end if;
  if (select count(*) from public.products p where p.id = any(v_products)
    and p.tenant_id = v_tenant and (p_action = 'remove' or
      (p.is_active and p.product_type = 'sku' and p.channel is distinct from 'fnb')))
    <> cardinality(v_products) then
    raise exception 'FNB_SUPPLY_PRODUCT_INVALID';
  end if;
  if p_action = 'add' then
    with changed as (
      insert into public.fnb_supply_catalog(tenant_id, branch_id, product_id, created_by)
      select v_tenant, b, p, v_actor from unnest(v_branches) b cross join unnest(v_products) p
      on conflict do nothing returning branch_id, product_id
    ) insert into public.fnb_supply_catalog_audit(tenant_id, branch_id, product_id, action, actor_id)
      select v_tenant, branch_id, product_id, 'add', v_actor from changed;
  else
    with changed as (
      delete from public.fnb_supply_catalog where tenant_id = v_tenant
        and branch_id = any(v_branches) and product_id = any(v_products)
      returning branch_id, product_id
    ) insert into public.fnb_supply_catalog_audit(tenant_id, branch_id, product_id, action, actor_id)
      select v_tenant, branch_id, product_id, 'remove', v_actor from changed;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
alter function public.save_fnb_supply_catalog(uuid[], uuid[], text) owner to postgres;
revoke all on function public.save_fnb_supply_catalog(uuid[], uuid[], text) from public, anon, authenticated;
grant execute on function public.save_fnb_supply_catalog(uuid[], uuid[], text) to authenticated;
comment on table public.fnb_supply_catalog is
  '00386: Draft F&B supply assignments only. No enforcement or stock/price mutation.';
commit;
