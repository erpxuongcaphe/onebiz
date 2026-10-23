-- Copy a global formula into one outlet without changing the global formula,
-- product/variant BOM links, stock, invoices or other outlets. Installation is DDL only.
begin;
create or replace function public.clone_bom_for_branch_atomic(
  p_source_bom_id uuid,
  p_target_branch_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_source public.bom%rowtype;
  v_created public.bom%rowtype;
  v_branch_name text;
  v_snapshot jsonb;
  v_items jsonb;
  v_exact jsonb;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select tenant_id into v_tenant from public.profiles where id = v_actor and is_active;
  if v_tenant is null or not coalesce(public.user_has_permission(v_actor, 'production.manage_bom'), false) then
    raise exception 'BOM_CLONE_PERMISSION_DENIED' using errcode = '42501';
  end if;
  select name into v_branch_name from public.branches
   where id = p_target_branch_id and tenant_id = v_tenant and is_active;
  if not found or not coalesce(public.user_has_branch_access(v_actor, p_target_branch_id), false) then
    raise exception 'BOM_CLONE_BRANCH_DENIED' using errcode = '42501';
  end if;
  -- Only clone requests share this lock; sales and source-recipe reads do not.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_source_bom_id::text || ':' || p_target_branch_id::text, 0));
  -- Capture header, base quantities and exact choices in one read snapshot.
  -- No row lock on the global recipe or its materials is needed.
  select jsonb_build_object('header', to_jsonb(b),
    'items', coalesce((select jsonb_agg(to_jsonb(bi) order by bi.sort_order, bi.id)
                        from public.bom_items bi where bi.bom_id = b.id), '[]'::jsonb),
    'exact', coalesce((select jsonb_agg(to_jsonb(q) order by q.id)
                        from public.bom_modifier_option_quantities q
                       where q.bom_id = b.id and q.tenant_id = v_tenant), '[]'::jsonb))
    into v_snapshot from public.bom b
   where b.id = p_source_bom_id and b.tenant_id = v_tenant;
  if not found then
    raise exception 'BOM_CLONE_SOURCE_NOT_FOUND' using errcode = '42501';
  end if;
  select * into v_source from jsonb_populate_record(null::public.bom, v_snapshot->'header');
  v_items := v_snapshot->'items';
  v_exact := v_snapshot->'exact';
  if not v_source.is_active or v_source.branch_id is not null then
    raise exception 'BOM_CLONE_GLOBAL_ACTIVE_REQUIRED';
  end if;
  -- Code is the shared lookup key. Changing it breaks product/size lookup.
  -- A code-less legacy formula is identified by its product + variant instead.
  if nullif(trim(v_source.code), '') is null and v_source.product_id is null then
    raise exception 'BOM_CLONE_SOURCE_LINK_REQUIRED';
  end if;
  -- Existing indexes also protect different sources with the same lookup key.
  if exists (
    select 1 from public.bom b
     where b.tenant_id = v_tenant and b.branch_id = p_target_branch_id and b.is_active
       and ((v_source.code is not null and b.code = v_source.code)
         or (v_source.product_id is not null and b.product_id = v_source.product_id
             and b.variant_id is not distinct from v_source.variant_id))
  ) then
    raise exception 'BOM_CLONE_TARGET_EXISTS';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'BOM_CLONE_EMPTY_RECIPE';
  end if;
  insert into public.bom(tenant_id, product_id, variant_id, branch_id, code, name,
                        version, is_active, batch_size, yield_qty, yield_unit, note)
  values(v_tenant, v_source.product_id, v_source.variant_id, p_target_branch_id,
         v_source.code, v_source.name || ' (' || v_branch_name || ')',
         1, true, v_source.batch_size, v_source.yield_qty, v_source.yield_unit, v_source.note)
  returning id into v_id;
  insert into public.bom_items(bom_id, material_id, quantity, unit, waste_percent,
                              sort_order, note, modifier_scale_target,
                              input_quantity, input_unit, conversion_factor)
  select v_id, bi.material_id, bi.quantity, bi.unit, bi.waste_percent,
         bi.sort_order, bi.note, bi.modifier_scale_target,
         bi.input_quantity, bi.input_unit, bi.conversion_factor
    from jsonb_populate_recordset(null::public.bom_items, v_items) bi;
  -- The UOM trigger may detect changed packaging. Refuse silent quantity drift.
  if exists (
    (select material_id, quantity, unit, waste_percent, sort_order, modifier_scale_target
       from public.bom_items where bom_id = v_id)
    except all
    (select bi.material_id, bi.quantity, bi.unit, bi.waste_percent, bi.sort_order, bi.modifier_scale_target
       from jsonb_populate_recordset(null::public.bom_items, v_items) bi)
  ) then
    raise exception 'BOM_CLONE_UOM_CHANGED';
  end if;
  insert into public.bom_modifier_option_quantities(
    tenant_id, bom_id, material_id, modifier_option_id, quantity, input_quantity, input_unit)
  select v_tenant, v_id, q.material_id, q.modifier_option_id, q.quantity, q.input_quantity, q.input_unit
    from jsonb_populate_recordset(null::public.bom_modifier_option_quantities, v_exact) q;
  -- Assert the existing sale resolver selects this copy for the linked SKU/size.
  if v_source.product_id is not null and
     public.get_active_bom_for_branch(v_source.product_id, p_target_branch_id, v_source.variant_id) is distinct from v_id then
    raise exception 'BOM_CLONE_LINK_MISMATCH';
  end if;
  select * into v_created from public.bom where id = v_id;
  return to_jsonb(v_created) || jsonb_build_object('branches', jsonb_build_object('name', v_branch_name));
exception when unique_violation then
  raise exception 'BOM_CLONE_TARGET_EXISTS';
end;
$function$;
revoke all on function public.clone_bom_for_branch_atomic(uuid,uuid) from public, anon;
grant execute on function public.clone_bom_for_branch_atomic(uuid,uuid) to authenticated;
comment on function public.clone_bom_for_branch_atomic(uuid,uuid) is
 'Atomically clone an active global BOM to an authorized branch, retaining code/size links, UOM, scale targets and exact option quantities. Never overwrites an existing branch recipe.';
commit;
