-- 00366: let an FnB size setup replace a same-product legacy parent BOM code.
--
-- A product configured before per-size recipes can already own a parent BOM
-- named like SKU-CAP-011-SIZEM. The first Size M save must archive that parent
-- code inside the same transaction, otherwise 00357 correctly rejects the
-- duplicate code. BOMs owned by another product or an existing variant remain
-- protected and still raise FNB_SIZE_SETUP_BOM_CODE_IN_USE.

begin;

do $prerequisite$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is null
     and to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00366_SIZE_SETUP_RPC_MISSING';
  end if;
end;
$prerequisite$;

do $preserve_00357$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is null then
    alter function public.save_fnb_size_setup_atomic(uuid, jsonb)
      rename to save_fnb_size_setup_atomic_00357;
  end if;
end;
$preserve_00357$;

revoke all on function public.save_fnb_size_setup_atomic_00357(uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.save_fnb_size_setup_atomic(
  p_product_id uuid,
  p_variants jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_variant jsonb;
  v_bom_code text;
  v_legacy_bom_id uuid;
  v_legacy_code text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select profile.tenant_id
    into v_tenant
    from public.profiles profile
   where profile.id = v_actor
     and profile.is_active;
  if v_tenant is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'products.edit') then
    raise exception using
      errcode = '42501',
      message = 'FNB_SIZE_SETUP_PERMISSION_DENIED';
  end if;

  perform 1
    from public.products product
   where product.id = p_product_id
     and product.tenant_id = v_tenant
     and product.product_type = 'sku'
     and product.channel = 'fnb'
   for update;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_SIZE_SETUP_PRODUCT_NOT_FNB_SKU';
  end if;

  if p_variants is null or jsonb_typeof(p_variants) <> 'array' then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_SIZE_SETUP_VARIANTS_INVALID';
  end if;

  for v_variant in select value from jsonb_array_elements(p_variants)
  loop
    v_bom_code := nullif(trim(v_variant->>'bomCode'), '');
    if v_bom_code is null then
      continue;
    end if;

    v_legacy_bom_id := null;
    select bom.id, bom.code
      into v_legacy_bom_id, v_legacy_code
      from public.bom bom
     where bom.tenant_id = v_tenant
       and bom.product_id = p_product_id
       and bom.variant_id is null
       and lower(bom.code) = lower(v_bom_code)
       and not exists (
         select 1
           from public.product_variants existing_variant
          where existing_variant.tenant_id = v_tenant
            and existing_variant.is_active
            and lower(existing_variant.bom_code) = lower(v_bom_code)
       )
     order by bom.is_active desc, bom.updated_at desc nulls last, bom.created_at desc
     limit 1
     for update;

    if v_legacy_bom_id is not null then
      update public.bom
         set code = v_legacy_code || '-LEGACY-' || left(replace(v_legacy_bom_id::text, '-', ''), 8),
             is_active = false,
             updated_at = now()
       where id = v_legacy_bom_id
         and tenant_id = v_tenant;

      update public.products
         set bom_code = null,
             updated_at = now()
       where id = p_product_id
         and tenant_id = v_tenant
         and lower(bom_code) = lower(v_legacy_code);
    end if;
  end loop;

  -- The archived code and the complete size replacement share this function
  -- transaction. Any validation or write failure in 00357 restores both.
  return public.save_fnb_size_setup_atomic_00357(p_product_id, p_variants);
end;
$function$;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

comment on function public.save_fnb_size_setup_atomic(uuid, jsonb) is
  '00366: Atomically archive a same-product legacy parent BOM code before the guarded 00357 FnB size replacement.';

commit;

notify pgrst, 'reload schema';
