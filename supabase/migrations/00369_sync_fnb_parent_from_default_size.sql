-- 00369: keep the FnB parent SKU summary aligned with its default size.
--
-- Saving size BOMs fires legacy BOM-cost triggers while the replacement is
-- still in progress. At that intermediate point a trigger can write an old
-- ingredient-cost total back to products.cost_price. Finalize the parent only
-- after the complete 00368 transaction has succeeded so catalog, reports and
-- POS all see the same representative price and Retail-based FnB cost.

begin;

do $prerequisite$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic(uuid,jsonb)') is null
     and to_regprocedure('public.save_fnb_size_setup_atomic_00368(uuid,jsonb)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_00369_SIZE_SETUP_RPC_MISSING';
  end if;
end;
$prerequisite$;

do $preserve_00368$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic_00368(uuid,jsonb)') is null then
    alter function public.save_fnb_size_setup_atomic(uuid, jsonb)
      rename to save_fnb_size_setup_atomic_00368;
  end if;
end;
$preserve_00368$;

revoke all on function public.save_fnb_size_setup_atomic_00368(uuid, jsonb)
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
  v_default_variant jsonb;
  v_result jsonb;
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

  if p_variants is null
     or jsonb_typeof(p_variants) <> 'array'
     or jsonb_array_length(p_variants) = 0 then
    raise exception using
      errcode = '22023',
      message = 'FNB_SIZE_SETUP_VARIANTS_INVALID';
  end if;

  select variant.value
    into v_default_variant
    from jsonb_array_elements(p_variants) variant(value)
   where coalesce((variant.value->>'isDefault')::boolean, false)
   limit 1;

  if v_default_variant is null then
    raise exception using
      errcode = '22023',
      message = 'FNB_SIZE_SETUP_DEFAULT_REQUIRED';
  end if;

  -- 00368 -> 00367 -> 00357 performs every guarded variant/BOM write.
  v_result := public.save_fnb_size_setup_atomic_00368(
    p_product_id,
    p_variants
  );

  -- This must remain the final product write in the transaction. The default
  -- size is the canonical representative shown outside the size matrix.
  update public.products product
     set sell_price = (v_default_variant->>'sellPrice')::numeric,
         cost_price = coalesce((v_default_variant->>'costPrice')::numeric, 0),
         has_bom = true,
         updated_at = now()
   where product.id = p_product_id
     and product.tenant_id = v_tenant
     and product.product_type = 'sku'
     and product.channel = 'fnb';

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'FNB_SIZE_SETUP_PRODUCT_NOT_FNB_SKU';
  end if;

  return v_result;
end;
$function$;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

comment on function public.save_fnb_size_setup_atomic(uuid, jsonb) is
  '00369: Atomically save FnB sizes then finalize the parent sale price, Retail-based cost and BOM flag from the default size.';

commit;

notify pgrst, 'reload schema';
