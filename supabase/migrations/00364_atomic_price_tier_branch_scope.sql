-- 00364 - Atomic replacement of FnB price-tier branch scope.
-- Depends on 00363_unified_sale_pricing.sql.

begin;

do $prerequisite$
begin
  if to_regclass('public.branch_price_tier_assignments') is null
     or to_regprocedure('public.save_branch_price_tier_assignments_00363(uuid,jsonb,text)') is null then
    raise exception using errcode = 'P0001', message = 'PRICING_00364_PREREQUISITE_MISSING';
  end if;
end;
$prerequisite$;

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
  v_branch_id uuid;
  v_mode text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_assignment_id uuid;
  v_old jsonb;
  v_new jsonb;
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
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'PRICE_ASSIGNMENT_PAYLOAD_INVALID';
  end if;

  perform 1 from public.price_tiers pt
   where pt.id = p_price_tier_id
     and pt.tenant_id = v_tenant
     and pt.scope in ('fnb', 'both')
     and pt.is_active
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_TIER_INVALID';
  end if;

  perform 1 from public.branch_price_tier_assignments a
   where a.tenant_id = v_tenant and a.price_tier_id = p_price_tier_id
   for update;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at, a.branch_id), '[]'::jsonb)
    into v_old
    from public.branch_price_tier_assignments a
   where a.tenant_id = v_tenant and a.price_tier_id = p_price_tier_id;

  -- The payload is the complete desired scope. Deleting first is safe because
  -- the function is one transaction; any validation error restores old rows.
  delete from public.branch_price_tier_assignments a
   where a.tenant_id = v_tenant and a.price_tier_id = p_price_tier_id;

  for v_assignment in
    select value from jsonb_array_elements(p_assignments)
  loop
    v_branch_id := nullif(v_assignment->>'branch_id', '')::uuid;
    v_mode := coalesce(nullif(v_assignment->>'validity_mode', ''), 'indefinite');
    v_starts_at := coalesce(nullif(v_assignment->>'starts_at', '')::timestamptz, now());
    v_ends_at := nullif(v_assignment->>'ends_at', '')::timestamptz;

    if v_branch_id is null
       or v_mode not in ('indefinite', 'fixed')
       or (v_mode = 'indefinite' and v_ends_at is not null)
       or (v_mode = 'fixed' and (v_ends_at is null or v_starts_at >= v_ends_at)) then
      raise exception using errcode = '22023', message = 'PRICE_ASSIGNMENT_RANGE_INVALID';
    end if;

    perform 1 from public.branches b
     where b.id = v_branch_id and b.tenant_id = v_tenant and b.is_active
     for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'PRICE_ASSIGNMENT_BRANCH_INVALID';
    end if;

    if exists (
      select 1 from public.branch_price_tier_assignments a
       where a.tenant_id = v_tenant
         and a.branch_id = v_branch_id
         and tstzrange(a.starts_at, a.ends_at, '[)')
             && tstzrange(v_starts_at, v_ends_at, '[)')
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'PRICE_ASSIGNMENT_OVERLAP',
        detail = v_branch_id::text;
    end if;

    insert into public.branch_price_tier_assignments (
      tenant_id, branch_id, price_tier_id, validity_mode,
      starts_at, ends_at, created_by, updated_by
    ) values (
      v_tenant, v_branch_id, p_price_tier_id, v_mode,
      v_starts_at, v_ends_at, v_actor, v_actor
    ) returning id into v_assignment_id;
    v_count := v_count + 1;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.starts_at, a.branch_id), '[]'::jsonb)
    into v_new
    from public.branch_price_tier_assignments a
   where a.tenant_id = v_tenant and a.price_tier_id = p_price_tier_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant, v_actor, 'price_assignment_replace', 'price_tier', p_price_tier_id,
    jsonb_build_object('assignments', v_old),
    jsonb_build_object(
      'assignments', v_new,
      'reason', nullif(trim(p_reason), ''),
      'batch_id', v_batch,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'count', v_count,
    'batch_id', v_batch
  );
end;
$function$;

alter function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text)
  owner to postgres;
revoke all on function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_branch_price_tier_assignments_00363(uuid, jsonb, text)
  to authenticated;

-- Delete exact product/size platform targets. The legacy RPC intentionally
-- remains product-only for backward compatibility.
create or replace function public.delete_platform_price_targets_00364(
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_input jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_platform text;
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
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception using errcode = '22023', message = 'PLATFORM_PRICE_INPUT_INVALID';
  end if;

  for v_input in select value from jsonb_array_elements(p_rows)
  loop
    v_product_id := nullif(v_input->>'product_id', '')::uuid;
    v_variant_id := nullif(v_input->>'variant_id', '')::uuid;
    v_platform := v_input->>'platform';
    if v_product_id is null
       or v_platform not in ('shopee_food', 'grab_food', 'gojek', 'be') then
      raise exception using errcode = '22023', message = 'PLATFORM_PRICE_INPUT_INVALID';
    end if;

    for v_row in
      select ppp.* from public.product_platform_prices ppp
       where ppp.tenant_id = v_tenant
         and ppp.product_id = v_product_id
         and ppp.variant_id is not distinct from v_variant_id
         and ppp.platform = v_platform
       for update
    loop
      insert into public.audit_log (
        tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
      ) values (
        v_tenant, v_actor, 'platform_price_delete', 'product_platform_price',
        v_row.id, to_jsonb(v_row), jsonb_build_object(
          'batch_id', v_batch,
          'product_id', v_product_id,
          'variant_id', v_variant_id,
          'platform', v_platform
        )
      );
      delete from public.product_platform_prices where id = v_row.id;
      v_deleted := v_deleted + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'deleted', v_deleted,
    'batch_id', v_batch
  );
end;
$function$;

alter function public.delete_platform_price_targets_00364(jsonb) owner to postgres;
revoke all on function public.delete_platform_price_targets_00364(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_platform_price_targets_00364(jsonb)
  to authenticated;

commit;

notify pgrst, 'reload schema';
