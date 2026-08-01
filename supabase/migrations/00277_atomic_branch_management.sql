-- ============================================================
-- 00277: Atomic branch management and settings
-- ============================================================
-- Definition only. Existing rows are not changed by this migration.

create or replace function public.save_branch_atomic(
  p_branch_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_old record;
  v_saved record;
  v_name text;
  v_branch_type text;
  v_legal_type text;
  v_cascade_mode text;
  v_cutoff integer;
  v_price_tier_id uuid;
  v_make_default boolean;
  v_action text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor
     and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception using errcode = '42501', message = 'MANAGE_BRANCHES_PERMISSION_REQUIRED';
  end if;
  -- Serialize default-branch changes for this tenant.
  perform 1 from public.tenants t where t.id = v_tenant_id for update;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'BRANCH_PAYLOAD_INVALID';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_payload) as item(key)
    where item.key not in (
      'name', 'code', 'branch_type', 'address', 'phone', 'is_active',
      'is_default', 'price_tier_id', 'legal_entity_type',
      'legal_entity_name', 'legal_tax_code', 'legal_registration_no',
      'cascade_mode', 'shift_cutoff_hour'
    )
  ) then
    raise exception using errcode = '22023', message = 'BRANCH_FIELD_NOT_ALLOWED';
  end if;

  if p_branch_id is null or p_payload ? 'name' then
    v_name := nullif(trim(coalesce(p_payload->>'name', '')), '');
    if v_name is null or length(v_name) > 160 then
      raise exception using errcode = '22023', message = 'BRANCH_NAME_INVALID';
    end if;
  end if;
  if p_payload ? 'code' and length(coalesce(p_payload->>'code', '')) > 50 then
    raise exception using errcode = '22023', message = 'BRANCH_CODE_INVALID';
  end if;
  if p_branch_id is null or p_payload ? 'branch_type' then
    v_branch_type := coalesce(nullif(p_payload->>'branch_type', ''), 'store');
    if v_branch_type not in ('store', 'warehouse', 'factory', 'office') then
      raise exception using errcode = '22023', message = 'BRANCH_TYPE_INVALID';
    end if;
  end if;
  if p_payload ? 'legal_entity_type' then
    v_legal_type := nullif(p_payload->>'legal_entity_type', '');
    if v_legal_type is not null and v_legal_type not in (
      'company', 'household', 'sole_proprietorship', 'individual'
    ) then
      raise exception using errcode = '22023', message = 'LEGAL_ENTITY_TYPE_INVALID';
    end if;
  end if;
  if p_branch_id is null or p_payload ? 'cascade_mode' then
    v_cascade_mode := coalesce(nullif(p_payload->>'cascade_mode', ''),
      case when v_branch_type in ('warehouse', 'factory') then 'production' else 'outlet' end);
    if v_cascade_mode not in ('production', 'outlet') then
      raise exception using errcode = '22023', message = 'CASCADE_MODE_INVALID';
    end if;
  end if;
  if p_branch_id is null or p_payload ? 'shift_cutoff_hour' then
    v_cutoff := coalesce((p_payload->>'shift_cutoff_hour')::integer, 3);
    if v_cutoff < 0 or v_cutoff > 23 then
      raise exception using errcode = '22023', message = 'SHIFT_CUTOFF_INVALID';
    end if;
  end if;
  if p_payload ? 'price_tier_id' then
    v_price_tier_id := nullif(p_payload->>'price_tier_id', '')::uuid;
    if v_price_tier_id is not null and not exists (
      select 1 from public.price_tiers pt
      where pt.id = v_price_tier_id
        and pt.tenant_id = v_tenant_id
        and coalesce(pt.is_active, true)
    ) then
      raise exception using errcode = '22023', message = 'PRICE_TIER_NOT_FOUND';
    end if;
  end if;

  if p_branch_id is null then
    v_make_default := coalesce((p_payload->>'is_default')::boolean, false)
      or not exists (
        select 1 from public.branches b
        where b.tenant_id = v_tenant_id and coalesce(b.is_active, true)
      );
    if v_make_default then
      update public.branches
         set is_default = false, updated_at = now()
       where tenant_id = v_tenant_id and is_default = true;
    end if;

    insert into public.branches (
      tenant_id, name, code, branch_type, address, phone,
      is_default, is_active, price_tier_id,
      legal_entity_type, legal_entity_name, legal_tax_code,
      legal_registration_no, cascade_mode, shift_cutoff_hour
    ) values (
      v_tenant_id,
      v_name,
      nullif(trim(coalesce(p_payload->>'code', '')), ''),
      v_branch_type,
      nullif(trim(coalesce(p_payload->>'address', '')), ''),
      nullif(trim(coalesce(p_payload->>'phone', '')), ''),
      v_make_default,
      coalesce((p_payload->>'is_active')::boolean, true),
      v_price_tier_id,
      v_legal_type,
      nullif(trim(coalesce(p_payload->>'legal_entity_name', '')), ''),
      nullif(trim(coalesce(p_payload->>'legal_tax_code', '')), ''),
      nullif(trim(coalesce(p_payload->>'legal_registration_no', '')), ''),
      v_cascade_mode,
      v_cutoff
    ) returning * into v_saved;
    v_action := 'create';
  else
    select b.* into v_old
      from public.branches b
     where b.id = p_branch_id and b.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
    end if;
    if p_payload ? 'is_active'
       and not (p_payload->>'is_active')::boolean
       and v_old.is_default then
      raise exception using errcode = '22023', message = 'DEFAULT_BRANCH_CANNOT_DEACTIVATE';
    end if;

    v_make_default := p_payload ? 'is_default'
      and coalesce((p_payload->>'is_default')::boolean, false);
    if v_make_default
       and not coalesce(
         case when p_payload ? 'is_active'
           then (p_payload->>'is_active')::boolean
           else v_old.is_active
         end,
         false
       ) then
      raise exception using errcode = '22023', message = 'INACTIVE_BRANCH_CANNOT_BE_DEFAULT';
    end if;
    if v_make_default then
      update public.branches
         set is_default = false, updated_at = now()
       where tenant_id = v_tenant_id
         and is_default = true
         and id <> v_old.id;
    end if;

    update public.branches b
       set name = case when p_payload ? 'name' then v_name else b.name end,
           code = case when p_payload ? 'code' then nullif(trim(coalesce(p_payload->>'code', '')), '') else b.code end,
           branch_type = case when p_payload ? 'branch_type' then v_branch_type else b.branch_type end,
           address = case when p_payload ? 'address' then nullif(trim(coalesce(p_payload->>'address', '')), '') else b.address end,
           phone = case when p_payload ? 'phone' then nullif(trim(coalesce(p_payload->>'phone', '')), '') else b.phone end,
           is_active = case when p_payload ? 'is_active' then (p_payload->>'is_active')::boolean else b.is_active end,
           is_default = case when v_make_default then true else b.is_default end,
           price_tier_id = case when p_payload ? 'price_tier_id' then v_price_tier_id else b.price_tier_id end,
           legal_entity_type = case when p_payload ? 'legal_entity_type' then v_legal_type else b.legal_entity_type end,
           legal_entity_name = case when p_payload ? 'legal_entity_name' then nullif(trim(coalesce(p_payload->>'legal_entity_name', '')), '') else b.legal_entity_name end,
           legal_tax_code = case when p_payload ? 'legal_tax_code' then nullif(trim(coalesce(p_payload->>'legal_tax_code', '')), '') else b.legal_tax_code end,
           legal_registration_no = case when p_payload ? 'legal_registration_no' then nullif(trim(coalesce(p_payload->>'legal_registration_no', '')), '') else b.legal_registration_no end,
           cascade_mode = case when p_payload ? 'cascade_mode' then v_cascade_mode else b.cascade_mode end,
           shift_cutoff_hour = case when p_payload ? 'shift_cutoff_hour' then v_cutoff else b.shift_cutoff_hour end,
           updated_at = now()
     where b.id = v_old.id and b.tenant_id = v_tenant_id
    returning * into v_saved;
    v_action := case
      when p_payload ? 'is_active' and not (p_payload->>'is_active')::boolean then 'deactivate'
      when p_payload ? 'is_active' and (p_payload->>'is_active')::boolean then 'activate'
      when v_make_default then 'set_default'
      else 'update'
    end;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, v_action, 'branch', v_saved.id,
    case when p_branch_id is null then null else to_jsonb(v_old) end,
    to_jsonb(v_saved) || jsonb_build_object('atomic', true)
  );
  return to_jsonb(v_saved);
end;
$$;

create or replace function public.update_branch_settings_atomic(
  p_branch_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_old jsonb;
  v_next jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not (
    public.user_has_permission(v_actor, 'system.manage_branches')
    or public.user_has_permission(v_actor, 'pos_fnb.manage_tables')
  ) then
    raise exception using errcode = '42501', message = 'BRANCH_SETTINGS_PERMISSION_REQUIRED';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) as item(key)
    where item.key not in (
      'pos_zone_order', 'pos_layout_mode', 'pos_canvas_width',
      'pos_canvas_height', 'pos_cart_position'
    )
  ) then
    raise exception using errcode = '22023', message = 'BRANCH_SETTINGS_INVALID';
  end if;
  if p_patch ? 'pos_zone_order' and jsonb_typeof(p_patch->'pos_zone_order') <> 'array' then
    raise exception using errcode = '22023', message = 'POS_ZONE_ORDER_INVALID';
  end if;
  if p_patch ? 'pos_zone_order' and (
    jsonb_array_length(p_patch->'pos_zone_order') > 200
    or exists (
      select 1
      from jsonb_array_elements(p_patch->'pos_zone_order') value
      where jsonb_typeof(value) <> 'string'
    )
  ) then
    raise exception using errcode = '22023', message = 'POS_ZONE_ORDER_INVALID';
  end if;
  if p_patch ? 'pos_layout_mode' and p_patch->>'pos_layout_mode' not in ('auto', 'manual') then
    raise exception using errcode = '22023', message = 'POS_LAYOUT_MODE_INVALID';
  end if;
  if p_patch ? 'pos_cart_position' and p_patch->>'pos_cart_position' not in ('right', 'bottom') then
    raise exception using errcode = '22023', message = 'POS_CART_POSITION_INVALID';
  end if;
  if p_patch ? 'pos_canvas_width' and (p_patch->>'pos_canvas_width')::numeric not between 320 and 5000 then
    raise exception using errcode = '22023', message = 'POS_CANVAS_WIDTH_INVALID';
  end if;
  if p_patch ? 'pos_canvas_height' and (p_patch->>'pos_canvas_height')::numeric not between 240 and 5000 then
    raise exception using errcode = '22023', message = 'POS_CANVAS_HEIGHT_INVALID';
  end if;

  select coalesce(b.settings, '{}'::jsonb)
    into v_old
    from public.branches b
   where b.id = p_branch_id and b.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, p_branch_id)
     and not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED';
  end if;

  v_next := v_old || p_patch;
  update public.branches
     set settings = v_next, updated_at = now()
   where id = p_branch_id and tenant_id = v_tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'update_settings', 'branch', p_branch_id,
    jsonb_build_object('settings', v_old),
    jsonb_build_object('settings', v_next, 'atomic', true)
  );
  return v_next;
end;
$$;

revoke all on function public.save_branch_atomic(uuid, jsonb) from public, anon;
grant execute on function public.save_branch_atomic(uuid, jsonb) to authenticated;
revoke all on function public.update_branch_settings_atomic(uuid, jsonb) from public, anon;
grant execute on function public.update_branch_settings_atomic(uuid, jsonb) to authenticated;

select
  to_regprocedure('public.save_branch_atomic(uuid,jsonb)') is not null as save_branch_atomic_ok,
  to_regprocedure('public.update_branch_settings_atomic(uuid,jsonb)') is not null as update_branch_settings_atomic_ok;
