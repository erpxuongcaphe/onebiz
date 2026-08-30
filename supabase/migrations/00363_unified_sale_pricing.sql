-- 00363 - Unified sale pricing foundation for Retail and FnB.
-- Adds scheduled branch assignments, per-size platform prices, sparse unique
-- guards, and a server resolver that returns both price and source.

begin;

do $prerequisite$
begin
  if to_regclass('public.price_tiers') is null
     or to_regclass('public.price_tier_items') is null
     or to_regclass('public.product_platform_prices') is null
     or to_regclass('public.product_variants') is null
     or to_regprocedure('public.user_has_permission(uuid,text)') is null then
    raise exception using errcode = 'P0001', message = 'PRICING_00363_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

alter table public.price_tiers
  add column if not exists revision integer not null default 1,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

alter table public.product_platform_prices
  add column if not exists variant_id uuid references public.product_variants(id) on delete cascade;

do $drop_old_unique$
declare
  v_constraint text;
begin
  select c.conname into v_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'product_platform_prices'
     and c.contype = 'u'
     and pg_get_constraintdef(c.oid) ilike '%tenant_id, product_id, platform%'
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.product_platform_prices drop constraint %I', v_constraint);
  end if;
end;
$drop_old_unique$;

create unique index if not exists uq_platform_price_product
  on public.product_platform_prices (tenant_id, product_id, platform)
  where variant_id is null;
create unique index if not exists uq_platform_price_variant
  on public.product_platform_prices (tenant_id, product_id, variant_id, platform)
  where variant_id is not null;
create index if not exists idx_platform_price_variant_lookup
  on public.product_platform_prices (tenant_id, product_id, variant_id, platform);

-- Never guess which financial row to keep. Production must reconcile any
-- duplicate explicitly before this migration adds the sparse unique keys.
do $duplicate_preflight$
begin
  if exists (
    select 1
      from public.price_tier_items
     group by price_tier_id, product_id, variant_id, min_qty
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PRICING_00363_DUPLICATE_TIER_ITEMS',
      detail = 'Reconcile duplicate price tier rows before applying 00363.';
  end if;
end;
$duplicate_preflight$;

create unique index if not exists uq_price_tier_item_product_qty
  on public.price_tier_items (price_tier_id, product_id, min_qty)
  where variant_id is null;
create unique index if not exists uq_price_tier_item_variant_qty
  on public.price_tier_items (price_tier_id, product_id, variant_id, min_qty)
  where variant_id is not null;

create table if not exists public.branch_price_tier_assignments (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  price_tier_id uuid not null references public.price_tiers(id) on delete cascade,
  validity_mode text not null default 'indefinite'
    check (validity_mode in ('indefinite', 'fixed')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (validity_mode = 'indefinite' and ends_at is null)
    or (validity_mode = 'fixed' and ends_at is not null and starts_at < ends_at)
  )
);

create index if not exists idx_branch_price_assignment_resolve
  on public.branch_price_tier_assignments (tenant_id, branch_id, starts_at desc, ends_at);
create index if not exists idx_branch_price_assignment_tier
  on public.branch_price_tier_assignments (tenant_id, price_tier_id);

comment on table public.branch_price_tier_assignments is
  'Versioned branch-to-price-tier assignments resolved by server time.';

-- Migrate the current branch mapping without overwriting scheduled data.
insert into public.branch_price_tier_assignments (
  tenant_id, branch_id, price_tier_id, validity_mode, starts_at
)
select b.tenant_id, b.id, b.price_tier_id, 'indefinite', now()
  from public.branches b
  join public.price_tiers pt
    on pt.id = b.price_tier_id and pt.tenant_id = b.tenant_id
 where b.price_tier_id is not null
   and not exists (
     select 1 from public.branch_price_tier_assignments a
      where a.tenant_id = b.tenant_id and a.branch_id = b.id
   );

alter table public.branch_price_tier_assignments enable row level security;
drop policy if exists branch_price_assignment_select on public.branch_price_tier_assignments;
create policy branch_price_assignment_select
  on public.branch_price_tier_assignments for select
  using (tenant_id = (select public.get_user_tenant_id()));

-- Assignment writes move to the audited RPC. Existing price-tier CRUD remains
-- available during the staged rollout; revoking it here would break the current
-- Thiết lập giá editor before its atomic item RPC is deployed.
revoke insert, update, delete on public.branch_price_tier_assignments from anon, authenticated;

create or replace function public.resolve_branch_price_tier_00363(
  p_branch_id uuid,
  p_at timestamptz default now()
) returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_tier uuid;
begin
  if auth.uid() is null or v_tenant is null or p_branch_id is null then
    return null;
  end if;

  select a.price_tier_id into v_tier
    from public.branch_price_tier_assignments a
    join public.price_tiers pt
      on pt.id = a.price_tier_id
     and pt.tenant_id = a.tenant_id
     and pt.is_active
     and pt.scope in ('fnb', 'both')
   where a.tenant_id = v_tenant
     and a.branch_id = p_branch_id
     and a.starts_at <= p_at
     and (a.ends_at is null or p_at < a.ends_at)
   order by a.starts_at desc, a.created_at desc
   limit 1;

  if v_tier is not null then return v_tier; end if;

  select b.price_tier_id into v_tier
    from public.branches b
    join public.price_tiers pt
      on pt.id = b.price_tier_id
     and pt.tenant_id = b.tenant_id
     and pt.is_active
     and pt.scope in ('fnb', 'both')
   where b.id = p_branch_id and b.tenant_id = v_tenant;
  return v_tier;
end;
$function$;

create or replace function public.save_branch_price_tier_assignments_00363(
  p_price_tier_id uuid,
  p_assignments jsonb,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_assignment jsonb;
  v_assignment_id uuid;
  v_branch_id uuid;
  v_mode text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_old jsonb;
  v_count integer := 0;
  v_batch uuid := extensions.uuid_generate_v4();
begin
  select p.tenant_id into v_tenant
    from public.profiles p
   where p.id = v_actor and p.is_active;
  if v_actor is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'PRICE_ASSIGNMENT_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.manage_prices')
     and not exists (
       select 1 from public.profiles p
        where p.id = v_actor and p.tenant_id = v_tenant and p.role = 'owner'
     ) then
    raise exception using errcode = '42501', message = 'PRICE_ASSIGNMENT_PERMISSION_DENIED';
  end if;

  perform 1 from public.price_tiers pt
   where pt.id = p_price_tier_id and pt.tenant_id = v_tenant
     and pt.scope in ('fnb', 'both') and pt.is_active
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_TIER_INVALID';
  end if;

  for v_assignment in
    select value from jsonb_array_elements(coalesce(p_assignments, '[]'::jsonb))
  loop
    v_assignment_id := nullif(v_assignment->>'id', '')::uuid;
    v_branch_id := (v_assignment->>'branch_id')::uuid;
    v_mode := coalesce(nullif(v_assignment->>'validity_mode', ''), 'indefinite');
    v_starts_at := coalesce(
      nullif(v_assignment->>'starts_at', '')::timestamptz,
      now()
    );
    v_ends_at := nullif(v_assignment->>'ends_at', '')::timestamptz;

    if v_mode not in ('indefinite', 'fixed')
       or (v_mode = 'indefinite' and v_ends_at is not null)
       or (v_mode = 'fixed' and (v_ends_at is null or v_starts_at >= v_ends_at)) then
      raise exception using errcode = '22023', message = 'PRICE_ASSIGNMENT_RANGE_INVALID';
    end if;

    perform 1 from public.branches b
     where b.id = v_branch_id and b.tenant_id = v_tenant for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_BRANCH_INVALID';
    end if;

    if v_assignment_id is not null then
      select to_jsonb(a) into v_old
        from public.branch_price_tier_assignments a
       where a.id = v_assignment_id and a.tenant_id = v_tenant
       for update;
      if v_old is null then
        raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_NOT_FOUND';
      end if;
    else
      v_old := null;
    end if;

    if exists (
      select 1 from public.branch_price_tier_assignments a
       where a.tenant_id = v_tenant
         and a.branch_id = v_branch_id
         and (v_assignment_id is null or a.id <> v_assignment_id)
         and tstzrange(a.starts_at, a.ends_at, '[)')
             && tstzrange(v_starts_at, v_ends_at, '[)')
    ) then
      raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_OVERLAP';
    end if;

    if v_assignment_id is null then
      insert into public.branch_price_tier_assignments (
        tenant_id, branch_id, price_tier_id, validity_mode,
        starts_at, ends_at, created_by, updated_by
      ) values (
        v_tenant, v_branch_id, p_price_tier_id, v_mode,
        v_starts_at, v_ends_at, v_actor, v_actor
      ) returning id into v_assignment_id;
    else
      update public.branch_price_tier_assignments
         set branch_id = v_branch_id,
             price_tier_id = p_price_tier_id,
             validity_mode = v_mode,
             starts_at = v_starts_at,
             ends_at = v_ends_at,
             updated_by = v_actor,
             updated_at = now()
       where id = v_assignment_id and tenant_id = v_tenant;
    end if;

    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_tenant, v_actor,
      case when v_old is null then 'price_assignment_create' else 'price_assignment_update' end,
      'branch_price_assignment', v_assignment_id, v_old,
      jsonb_build_object(
        'batch_id', v_batch,
        'reason', nullif(trim(p_reason), ''),
        'branch_id', v_branch_id,
        'price_tier_id', p_price_tier_id,
        'validity_mode', v_mode,
        'starts_at', v_starts_at,
        'ends_at', v_ends_at
      )
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count, 'batch_id', v_batch);
end;
$function$;

create or replace function public.upsert_product_platform_prices(
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_platform text;
  v_price numeric;
  v_id uuid;
  v_old jsonb;
  v_count integer := 0;
  v_batch uuid := extensions.uuid_generate_v4();
begin
  select p.tenant_id into v_tenant
    from public.profiles p where p.id = v_actor and p.is_active;
  if v_actor is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'PLATFORM_PRICE_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.manage_prices')
     and not exists (
       select 1 from public.profiles p
        where p.id = v_actor and p.tenant_id = v_tenant and p.role = 'owner'
     ) then
    raise exception using errcode = '42501', message = 'PLATFORM_PRICE_PERMISSION_DENIED';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_product_id := (v_row->>'product_id')::uuid;
    v_variant_id := nullif(v_row->>'variant_id', '')::uuid;
    v_platform := v_row->>'platform';
    v_price := (v_row->>'override_price')::numeric;
    if v_platform not in ('shopee_food', 'grab_food', 'gojek', 'be')
       or v_price <= 0 then
      raise exception using errcode = '22023', message = 'PLATFORM_PRICE_INPUT_INVALID';
    end if;

    perform 1 from public.products p
     where p.id = v_product_id and p.tenant_id = v_tenant and p.channel = 'fnb';
    if not found then
      raise exception using errcode = 'P0001', message = 'PLATFORM_PRICE_PRODUCT_INVALID';
    end if;
    if v_variant_id is not null and not exists (
      select 1 from public.product_variants pv
       where pv.id = v_variant_id and pv.product_id = v_product_id
         and pv.tenant_id = v_tenant and pv.is_active
    ) then
      raise exception using errcode = 'P0001', message = 'PLATFORM_PRICE_VARIANT_INVALID';
    end if;

    select to_jsonb(ppp) into v_old
      from public.product_platform_prices ppp
     where ppp.tenant_id = v_tenant
       and ppp.product_id = v_product_id
       and ppp.platform = v_platform
       and ppp.variant_id is not distinct from v_variant_id
     for update;

    if v_variant_id is null then
      insert into public.product_platform_prices (
        tenant_id, product_id, variant_id, platform, override_price, set_by
      ) values (v_tenant, v_product_id, null, v_platform, v_price, v_actor)
      on conflict (tenant_id, product_id, platform) where variant_id is null
      do update set override_price = excluded.override_price,
                    set_by = excluded.set_by,
                    set_at = now()
      returning id into v_id;
    else
      insert into public.product_platform_prices (
        tenant_id, product_id, variant_id, platform, override_price, set_by
      ) values (v_tenant, v_product_id, v_variant_id, v_platform, v_price, v_actor)
      on conflict (tenant_id, product_id, variant_id, platform) where variant_id is not null
      do update set override_price = excluded.override_price,
                    set_by = excluded.set_by,
                    set_at = now()
      returning id into v_id;
    end if;

    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_tenant, v_actor, 'platform_price_upsert', 'product_platform_price',
      v_id, v_old,
      jsonb_build_object(
        'batch_id', v_batch,
        'product_id', v_product_id,
        'variant_id', v_variant_id,
        'platform', v_platform,
        'override_price', v_price
      )
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count, 'batch_id', v_batch);
end;
$function$;

alter function public.resolve_branch_price_tier_00363(uuid, timestamptz) owner to postgres;
alter function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text) owner to postgres;
alter function public.upsert_product_platform_prices(jsonb) owner to postgres;

revoke all on function public.resolve_branch_price_tier_00363(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_product_platform_prices(jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_branch_price_tier_00363(uuid, timestamptz)
  to authenticated;
grant execute on function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text)
  to authenticated;
grant execute on function public.upsert_product_platform_prices(jsonb)
  to authenticated;

-- Keep the existing product-level delete contract, but never let it remove
-- per-size overrides introduced by this migration.
create or replace function public.delete_product_platform_prices(
  p_product_ids uuid[],
  p_platform text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_row record;
  v_deleted integer := 0;
  v_batch uuid := extensions.uuid_generate_v4();
begin
  select p.tenant_id into v_tenant
    from public.profiles p where p.id = v_actor and p.is_active;
  if v_actor is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'PLATFORM_PRICE_AUTH_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.manage_prices')
     and not exists (
       select 1 from public.profiles p
        where p.id = v_actor and p.tenant_id = v_tenant and p.role = 'owner'
     ) then
    raise exception using errcode = '42501', message = 'PLATFORM_PRICE_PERMISSION_DENIED';
  end if;
  if p_platform not in ('shopee_food', 'grab_food', 'gojek', 'be') then
    raise exception using errcode = '22023', message = 'PLATFORM_PRICE_INPUT_INVALID';
  end if;

  for v_row in
    select ppp.* from public.product_platform_prices ppp
     where ppp.tenant_id = v_tenant
       and ppp.product_id = any(coalesce(p_product_ids, array[]::uuid[]))
       and ppp.platform = p_platform
       and ppp.variant_id is null
     for update
  loop
    insert into public.audit_log (
      tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      v_tenant, v_actor, 'platform_price_delete', 'product_platform_price',
      v_row.id, to_jsonb(v_row), jsonb_build_object('batch_id', v_batch)
    );
    delete from public.product_platform_prices where id = v_row.id;
    v_deleted := v_deleted + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'batch_id', v_batch
  );
end;
$function$;

alter function public.delete_product_platform_prices(uuid[], text) owner to postgres;
revoke all on function public.delete_product_platform_prices(uuid[], text)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_product_platform_prices(uuid[], text)
  to authenticated;

create or replace function public.resolve_sale_price_00363(
  p_product_id uuid,
  p_variant_id uuid default null,
  p_branch_id uuid default null,
  p_customer_id uuid default null,
  p_channel text default 'fnb',
  p_platform text default 'direct',
  p_quantity numeric default 1,
  p_at timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_product record;
  v_variant record;
  v_tier_id uuid;
  v_tier_item record;
  v_platform_price record;
  v_list_price numeric;
  v_unit_price numeric;
  v_source text;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'SALE_PRICE_AUTH_REQUIRED';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'SALE_PRICE_QUANTITY_INVALID';
  end if;
  if p_channel not in ('retail', 'fnb') then
    raise exception using errcode = '22023', message = 'SALE_PRICE_CHANNEL_INVALID';
  end if;
  if p_platform not in ('direct', 'shopee_food', 'grab_food', 'gojek', 'be') then
    raise exception using errcode = '22023', message = 'SALE_PRICE_PLATFORM_INVALID';
  end if;

  select p.id, p.sell_price into v_product
    from public.products p
   where p.id = p_product_id and p.tenant_id = v_tenant and p.is_active;
  if not found then
    raise exception using errcode = 'P0001', message = 'SALE_PRICE_PRODUCT_NOT_FOUND';
  end if;

  if p_variant_id is not null then
    select pv.id, pv.sell_price into v_variant
      from public.product_variants pv
     where pv.id = p_variant_id
       and pv.product_id = p_product_id
       and pv.tenant_id = v_tenant
       and pv.is_active;
    if not found then
      raise exception using errcode = 'P0001', message = 'SALE_PRICE_VARIANT_NOT_FOUND';
    end if;
  end if;
  v_list_price := case when p_variant_id is null
    then v_product.sell_price else v_variant.sell_price end;

  if p_channel = 'fnb' and p_platform <> 'direct' then
    select ppp.id, ppp.override_price, ppp.variant_id into v_platform_price
      from public.product_platform_prices ppp
     where ppp.tenant_id = v_tenant
       and ppp.product_id = p_product_id
       and ppp.platform = p_platform
       and (ppp.variant_id = p_variant_id or ppp.variant_id is null)
     order by (ppp.variant_id is not null) desc, ppp.set_at desc
     limit 1;
    if found then
      v_unit_price := v_platform_price.override_price;
      v_source := case when v_platform_price.variant_id is null
        then 'platform_product' else 'platform_variant' end;
    end if;
  end if;

  if v_unit_price is null then
    if p_channel = 'fnb' and p_branch_id is not null then
      v_tier_id := public.resolve_branch_price_tier_00363(p_branch_id, p_at);
    elsif p_channel = 'retail' and p_customer_id is not null then
      select c.price_tier_id into v_tier_id
        from public.customers c
        join public.price_tiers pt
          on pt.id = c.price_tier_id and pt.tenant_id = c.tenant_id
         and pt.is_active and pt.scope in ('retail', 'both')
       where c.id = p_customer_id and c.tenant_id = v_tenant;
    end if;

    if v_tier_id is not null then
      select pti.id, pti.price, pti.variant_id, pti.min_qty into v_tier_item
        from public.price_tier_items pti
       where pti.price_tier_id = v_tier_id
         and pti.product_id = p_product_id
         and pti.min_qty <= p_quantity
         and (pti.variant_id = p_variant_id or pti.variant_id is null)
       order by (pti.variant_id is not null) desc,
                pti.min_qty desc, pti.created_at desc
       limit 1;
      if found then
        v_unit_price := v_tier_item.price;
        v_source := case when v_tier_item.variant_id is null
          then 'tier_product' else 'tier_variant' end;
      end if;
    end if;
  end if;

  if v_unit_price is null then
    v_unit_price := v_list_price;
    v_source := case when p_variant_id is null
      then 'catalog_product' else 'catalog_variant' end;
  end if;
  if p_channel = 'fnb' and coalesce(v_unit_price, 0) <= 0 then
    raise exception using errcode = 'P0001', message = 'SALE_PRICE_FNB_NOT_POSITIVE';
  end if;

  return jsonb_build_object(
    'unit_price', v_unit_price,
    'list_price', v_list_price,
    'source', v_source,
    'product_id', p_product_id,
    'variant_id', p_variant_id,
    'quantity', p_quantity,
    'price_tier_id', v_tier_id,
    'price_tier_item_id', v_tier_item.id,
    'platform_price_id', v_platform_price.id,
    'resolved_at', p_at
  );
end;
$function$;

alter function public.resolve_sale_price_00363(uuid, uuid, uuid, uuid, text, text, numeric, timestamptz) owner to postgres;
revoke all on function public.resolve_sale_price_00363(uuid, uuid, uuid, uuid, text, text, numeric, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_sale_price_00363(uuid, uuid, uuid, uuid, text, text, numeric, timestamptz)
  to authenticated;

create or replace function public.calculate_fnb_bom_retail_cost_00363(
  p_bom_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_product_id uuid;
  v_invalid record;
  v_total numeric := 0;
  v_breakdown jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception using errcode = '42501', message = 'FNB_BOM_COST_AUTH_REQUIRED';
  end if;

  select b.product_id into v_product_id
    from public.bom b
    join public.products p
      on p.id = b.product_id and p.tenant_id = b.tenant_id
   where b.id = p_bom_id
     and b.tenant_id = v_tenant
     and p.channel = 'fnb';
  if not found then
    raise exception using errcode = 'P0001', message = 'FNB_BOM_COST_NOT_FOUND';
  end if;

  select p.code, p.name into v_invalid
    from public.bom_items bi
    join public.products p on p.id = bi.material_id
   where bi.bom_id = p_bom_id
     and p.tenant_id = v_tenant
     and coalesce(p.sell_price, 0) <= 0
   order by bi.sort_order, bi.id
   limit 1;
  if found then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_COMPONENT_RETAIL_PRICE_MISSING',
      detail = format('%s - %s', v_invalid.code, v_invalid.name);
  end if;

  select
    coalesce(sum(
      bi.quantity * (1 + coalesce(bi.waste_percent, 0) / 100) * p.sell_price
    ), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'material_id', p.id,
        'code', p.code,
        'name', p.name,
        'stock_quantity', bi.quantity,
        'stock_unit', bi.unit,
        'waste_percent', coalesce(bi.waste_percent, 0),
        'retail_unit_price', p.sell_price,
        'line_cost', bi.quantity * (1 + coalesce(bi.waste_percent, 0) / 100) * p.sell_price
      ) order by bi.sort_order, bi.id
    ), '[]'::jsonb)
    into v_total, v_breakdown
    from public.bom_items bi
    join public.products p
      on p.id = bi.material_id and p.tenant_id = v_tenant
   where bi.bom_id = p_bom_id;

  return jsonb_build_object(
    'bom_id', p_bom_id,
    'product_id', v_product_id,
    'cost_source', 'component_retail_sell_price',
    'total_cost', v_total,
    'items', v_breakdown
  );
end;
$function$;

alter function public.calculate_fnb_bom_retail_cost_00363(uuid) owner to postgres;
revoke all on function public.calculate_fnb_bom_retail_cost_00363(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.calculate_fnb_bom_retail_cost_00363(uuid)
  to authenticated;

commit;

notify pgrst, 'reload schema';
