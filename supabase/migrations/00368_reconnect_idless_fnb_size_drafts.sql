-- 00368: reconnect an id-less FnB size draft to its exact existing variant.
--
-- A browser draft created before the atomic size flow can retain the size name
-- and BOM code but not the server variant id. If the exact active variant now
-- exists, creating a second row would collide with its BOM code. This wrapper
-- adds the id only when tenant, product, name and BOM code identify exactly one
-- active row. All writes remain in the guarded 00367 -> 00357 transaction.

begin;

do $prerequisite$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is null
     and to_regprocedure('public.save_fnb_size_setup_atomic_00367(uuid,jsonb)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00368_SIZE_SETUP_RPC_MISSING';
  end if;
end;
$prerequisite$;

do $preserve_00367$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic_00367(uuid,jsonb)') is null then
    alter function public.save_fnb_size_setup_atomic(uuid, jsonb)
      rename to save_fnb_size_setup_atomic_00367;
  end if;
end;
$preserve_00367$;

revoke all on function public.save_fnb_size_setup_atomic_00367(uuid, jsonb)
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
  v_variant_id_text text;
  v_existing_variant_id uuid;
  v_candidate_count integer;
  v_name text;
  v_bom_code text;
  v_normalized_variants jsonb := '[]'::jsonb;
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
    v_variant_id_text := nullif(trim(v_variant->>'id'), '');
    v_name := nullif(trim(v_variant->>'name'), '');
    v_bom_code := nullif(trim(v_variant->>'bomCode'), '');

    if v_variant_id_text is null and v_name is not null and v_bom_code is not null then
      select count(*), (array_agg(existing_variant.id order by existing_variant.id::text))[1]
        into v_candidate_count, v_existing_variant_id
        from public.product_variants existing_variant
       where existing_variant.tenant_id = v_tenant
         and existing_variant.product_id = p_product_id
         and existing_variant.is_active
         and lower(trim(existing_variant.name)) = lower(v_name)
         and lower(trim(existing_variant.bom_code)) = lower(v_bom_code);

      if v_candidate_count = 1 then
        v_variant := jsonb_set(
          v_variant,
          '{id}',
          to_jsonb(v_existing_variant_id::text),
          true
        );
      end if;
    end if;

    v_normalized_variants := v_normalized_variants || jsonb_build_array(v_variant);
  end loop;

  return public.save_fnb_size_setup_atomic_00367(
    p_product_id,
    v_normalized_variants
  );
end;
$function$;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

comment on function public.save_fnb_size_setup_atomic(uuid, jsonb) is
  '00368: Reconnect an id-less draft only to its unique exact same-product variant before guarded atomic size setup.';

commit;

notify pgrst, 'reload schema';
