-- ============================================================
-- ONEBIZ QC BATCH D: migrations 00277 through 00283
-- Run once in Supabase SQL Editor.
-- Definition-only batch: does not update business records.
-- All-or-nothing: any error rolls back this entire batch.
-- ============================================================

begin;
-- ==================== 00277_atomic_branch_management.sql ====================
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


-- ==================== 00278_atomic_operational_settings.sql ====================
-- ============================================================
-- 00278: Atomic operational settings and branch print brand
-- ============================================================
-- Definition only. Existing business rows are not changed.

create or replace function public.patch_tenant_settings_atomic(
  p_section text,
  p_value jsonb,
  p_replace boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_settings jsonb;
  v_old jsonb;
  v_next jsonb;
  v_item jsonb;
  v_id text;
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
  if p_section not in ('business_info', 'fnb_delivery_platforms', 'fnb_discount_presets') then
    raise exception using errcode = '22023', message = 'SETTINGS_SECTION_NOT_ALLOWED';
  end if;
  if p_section = 'business_info'
     and not public.user_has_permission(v_actor, 'system.manage_roles') then
    raise exception using errcode = '42501', message = 'MANAGE_SYSTEM_SETTINGS_PERMISSION_REQUIRED';
  end if;
  if p_section in ('fnb_delivery_platforms', 'fnb_discount_presets')
     and not (
       public.user_has_permission(v_actor, 'system.manage_roles')
       or public.user_has_permission(v_actor, 'pos_fnb.manage_tables')
     ) then
    raise exception using errcode = '42501', message = 'MANAGE_FNB_SETTINGS_PERMISSION_REQUIRED';
  end if;

  if (p_section = 'fnb_discount_presets') is distinct from p_replace then
    raise exception using errcode = '22023', message = 'SETTINGS_REPLACE_MODE_INVALID';
  end if;

  if p_section = 'business_info' then
    if p_value is null or jsonb_typeof(p_value) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_value) as item(key)
      where item.key not in (
        'business_name', 'tax_code', 'address', 'phone', 'email', 'website',
        'logo_url', 'bank_account', 'bank_name', 'bank_bin', 'bank_code',
        'bank_holder', 'vietqr_enabled', 'invoice_footer', 'invoice_title',
        'invoice_fields'
      )
    ) then
      raise exception using errcode = '22023', message = 'BUSINESS_INFO_INVALID';
    end if;
    if exists (
      select 1 from jsonb_each(p_value) item
      where item.key <> 'invoice_fields'
        and item.key <> 'vietqr_enabled'
        and jsonb_typeof(item.value) not in ('string', 'null')
    ) or (p_value ? 'vietqr_enabled' and jsonb_typeof(p_value->'vietqr_enabled') not in ('boolean', 'null'))
       or (p_value ? 'invoice_fields' and jsonb_typeof(p_value->'invoice_fields') not in ('object', 'null'))
       or (p_value ? 'invoice_fields' and jsonb_typeof(p_value->'invoice_fields') = 'object' and exists (
         select 1 from jsonb_each(p_value->'invoice_fields') field
         where jsonb_typeof(field.value) <> 'boolean'
       )) then
      raise exception using errcode = '22023', message = 'BUSINESS_INFO_TYPE_INVALID';
    end if;
    if length(coalesce(p_value->>'business_name', '')) > 200
       or length(coalesce(p_value->>'tax_code', '')) > 50
       or length(coalesce(p_value->>'address', '')) > 500
       or length(coalesce(p_value->>'phone', '')) > 50
       or length(coalesce(p_value->>'email', '')) > 254
       or length(coalesce(p_value->>'website', '')) > 500
       or length(coalesce(p_value->>'logo_url', '')) > 2000
       or length(coalesce(p_value->>'invoice_footer', '')) > 1000
       or length(coalesce(p_value->>'invoice_title', '')) > 200 then
      raise exception using errcode = '22023', message = 'BUSINESS_INFO_TOO_LONG';
    end if;
  elsif p_section = 'fnb_delivery_platforms' then
    if p_value is null or jsonb_typeof(p_value) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_value) as item(key)
      where item.key not in ('shopee_food', 'grab_food', 'gojek', 'be', 'direct')
    ) then
      raise exception using errcode = '22023', message = 'FNB_PLATFORMS_INVALID';
    end if;
    for v_item in select value from jsonb_each(p_value)
    loop
      if jsonb_typeof(v_item) <> 'object'
         or not (v_item ? 'active')
         or not (v_item ? 'commissionPercent')
         or exists (
           select 1 from jsonb_object_keys(v_item) as field(key)
           where field.key not in ('active', 'commissionPercent', 'label')
         )
         or jsonb_typeof(v_item->'active') <> 'boolean'
         or jsonb_typeof(v_item->'commissionPercent') <> 'number'
         or (v_item->>'commissionPercent')::numeric not between 0 and 100
         or (v_item ? 'label' and jsonb_typeof(v_item->'label') not in ('string', 'null'))
         or length(coalesce(v_item->>'label', '')) > 80 then
        raise exception using errcode = '22023', message = 'FNB_PLATFORM_CONFIG_INVALID';
      end if;
    end loop;
  else
    if p_value is null or jsonb_typeof(p_value) <> 'array'
       or jsonb_array_length(p_value) > 100 then
      raise exception using errcode = '22023', message = 'FNB_DISCOUNT_PRESETS_INVALID';
    end if;
    for v_item in select value from jsonb_array_elements(p_value)
    loop
      if jsonb_typeof(v_item) <> 'object'
         or not (v_item ? 'id')
         or not (v_item ? 'name')
         or not (v_item ? 'mode')
         or not (v_item ? 'value')
         or not (v_item ? 'active')
         or exists (
           select 1 from jsonb_object_keys(v_item) as field(key)
           where field.key not in ('id', 'name', 'mode', 'value', 'active')
         )
         or jsonb_typeof(v_item->'id') <> 'string'
         or length(coalesce(v_item->>'id', '')) not between 1 and 120
         or jsonb_typeof(v_item->'name') <> 'string'
         or length(trim(coalesce(v_item->>'name', ''))) not between 1 and 120
         or v_item->>'mode' not in ('amount', 'percent')
         or jsonb_typeof(v_item->'value') <> 'number'
         or (v_item->>'value')::numeric <= 0
         or (v_item->>'mode' = 'percent' and (v_item->>'value')::numeric > 100)
         or jsonb_typeof(v_item->'active') <> 'boolean' then
        raise exception using errcode = '22023', message = 'FNB_DISCOUNT_PRESET_INVALID';
      end if;
      v_id := v_item->>'id';
      if (select count(*) from jsonb_array_elements(p_value) x where x->>'id' = v_id) > 1 then
        raise exception using errcode = '22023', message = 'FNB_DISCOUNT_PRESET_DUPLICATE';
      end if;
    end loop;
  end if;

  select coalesce(t.settings, '{}'::jsonb)
    into v_settings
    from public.tenants t
   where t.id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'TENANT_NOT_FOUND';
  end if;
  v_old := coalesce(v_settings->p_section,
    case when p_section = 'fnb_discount_presets' then '[]'::jsonb else '{}'::jsonb end);
  if p_replace then
    v_next := p_value;
  else
    if jsonb_typeof(v_old) <> 'object' or jsonb_typeof(p_value) <> 'object' then
      raise exception using errcode = '22023', message = 'SETTINGS_MERGE_REQUIRES_OBJECT';
    end if;
    v_next := v_old || p_value;
  end if;

  update public.tenants
     set settings = jsonb_set(v_settings, array[p_section], v_next, true),
         updated_at = now()
   where id = v_tenant_id;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'update', 'tenant_setting', v_tenant_id,
    jsonb_build_object('section', p_section, 'value', v_old),
    jsonb_build_object('section', p_section, 'value', v_next, 'atomic', true)
  );
  return v_next;
end;
$$;

create or replace function public.set_branch_print_brand_atomic(
  p_branch_id uuid,
  p_brand jsonb
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
  if not public.user_has_permission(v_actor, 'system.manage_branches') then
    raise exception using errcode = '42501', message = 'MANAGE_BRANCHES_PERMISSION_REQUIRED';
  end if;
  if p_brand is not null and (
    jsonb_typeof(p_brand) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_brand) as item(key)
      where item.key not in (
        'logoUrl', 'businessName', 'taxCode', 'address', 'phone', 'footer',
        'bankBin', 'bankCode', 'bankHolder', 'bankAccount', 'vietQrEnabled'
      )
    )
    or exists (
      select 1 from jsonb_each(p_brand) item
      where item.key <> 'vietQrEnabled' and jsonb_typeof(item.value) not in ('string', 'null')
    )
    or (p_brand ? 'vietQrEnabled' and jsonb_typeof(p_brand->'vietQrEnabled') not in ('boolean', 'null'))
    or length(coalesce(p_brand->>'address', '')) > 500
    or length(coalesce(p_brand->>'phone', '')) > 50
    or length(coalesce(p_brand->>'taxCode', '')) > 50
  ) then
    raise exception using errcode = '22023', message = 'BRANCH_PRINT_BRAND_INVALID';
  end if;

  select b.print_brand into v_old
    from public.branches b
   where b.id = p_branch_id and b.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'BRANCH_NOT_FOUND';
  end if;
  update public.branches
     set print_brand = p_brand, updated_at = now()
   where id = p_branch_id and tenant_id = v_tenant_id;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'update_print_brand', 'branch', p_branch_id,
    jsonb_build_object('print_brand', v_old),
    jsonb_build_object('print_brand', p_brand, 'atomic', true)
  );
  return coalesce(p_brand, 'null'::jsonb);
end;
$$;

revoke all on function public.patch_tenant_settings_atomic(text, jsonb, boolean) from public, anon;
grant execute on function public.patch_tenant_settings_atomic(text, jsonb, boolean) to authenticated;
revoke all on function public.set_branch_print_brand_atomic(uuid, jsonb) from public, anon;
grant execute on function public.set_branch_print_brand_atomic(uuid, jsonb) to authenticated;

select
  to_regprocedure('public.patch_tenant_settings_atomic(text,jsonb,boolean)') is not null as tenant_settings_atomic_ok,
  to_regprocedure('public.set_branch_print_brand_atomic(uuid,jsonb)') is not null as branch_print_brand_atomic_ok;


-- ==================== 00279_atomic_managed_user_update.sql ====================
-- ============================================================
-- 00279: Atomic managed-user profile and branch access update
-- ============================================================
-- Definition only. Existing users and branch assignments are not changed.

create or replace function public.update_managed_user_atomic(
  p_target_user_id uuid,
  p_profile_patch jsonb default '{}'::jsonb,
  p_branch_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_target record;
  v_saved record;
  v_role_id uuid;
  v_old_branches uuid[];
  v_new_branches uuid[];
  v_full_name text;
  v_phone text;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_actor_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_actor_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'system.manage_users') then
    raise exception using errcode = '42501', message = 'MANAGE_USERS_PERMISSION_REQUIRED';
  end if;
  if p_target_user_id is null then
    raise exception using errcode = '22023', message = 'TARGET_USER_REQUIRED';
  end if;
  if p_profile_patch is null or jsonb_typeof(p_profile_patch) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_profile_patch) as item(key)
    where item.key not in ('full_name', 'phone', 'role_id', 'is_active')
  ) then
    raise exception using errcode = '22023', message = 'PROFILE_PATCH_INVALID';
  end if;

  select p.* into v_target
    from public.profiles p
   where p.id = p_target_user_id
     and p.tenant_id = v_actor_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'TARGET_USER_NOT_FOUND';
  end if;
  if v_target.role = 'owner' and v_actor_profile.role <> 'owner' then
    raise exception using errcode = '42501', message = 'ONLY_OWNER_CAN_UPDATE_OWNER';
  end if;
  if v_target.role = 'owner' and p_profile_patch ? 'role_id' then
    raise exception using errcode = '22023', message = 'OWNER_ROLE_CANNOT_CHANGE';
  end if;
  if p_target_user_id = v_actor
     and p_profile_patch ? 'is_active'
     and not (p_profile_patch->>'is_active')::boolean then
    raise exception using errcode = '22023', message = 'CANNOT_DEACTIVATE_SELF';
  end if;

  if p_profile_patch ? 'full_name' then
    v_full_name := nullif(trim(coalesce(p_profile_patch->>'full_name', '')), '');
    if v_full_name is null or length(v_full_name) > 160 then
      raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
    end if;
  end if;
  if p_profile_patch ? 'phone' then
    v_phone := nullif(trim(coalesce(p_profile_patch->>'phone', '')), '');
    if length(coalesce(v_phone, '')) > 32 then
      raise exception using errcode = '22023', message = 'PHONE_INVALID';
    end if;
  end if;
  if p_profile_patch ? 'role_id' then
    v_role_id := nullif(p_profile_patch->>'role_id', '')::uuid;
    if v_role_id is not null and not exists (
      select 1 from public.roles r
       where r.id = v_role_id and r.tenant_id = v_actor_profile.tenant_id
    ) then
      raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
    end if;
  end if;
  if p_profile_patch ? 'is_active'
     and jsonb_typeof(p_profile_patch->'is_active') <> 'boolean' then
    raise exception using errcode = '22023', message = 'IS_ACTIVE_INVALID';
  end if;

  select coalesce(array_agg(ub.branch_id order by ub.branch_id), '{}'::uuid[])
    into v_old_branches
    from public.user_branches ub
   where ub.user_id = p_target_user_id;

  if p_branch_ids is not null then
    if cardinality(p_branch_ids) = 0
       or cardinality(p_branch_ids) <> (
         select count(distinct item.branch_id)::integer
           from unnest(p_branch_ids) as item(branch_id)
       )
       or cardinality(p_branch_ids) <> (
         select count(*)::integer
           from public.branches b
          where b.id = any(p_branch_ids)
            and b.tenant_id = v_actor_profile.tenant_id
            and coalesce(b.is_active, true)
       ) then
      raise exception using errcode = '22023', message = 'BRANCH_SCOPE_INVALID';
    end if;
  end if;

  update public.profiles p
     set full_name = case when p_profile_patch ? 'full_name' then v_full_name else p.full_name end,
         phone = case when p_profile_patch ? 'phone' then v_phone else p.phone end,
         role_id = case when p_profile_patch ? 'role_id' then v_role_id else p.role_id end,
         is_active = case when p_profile_patch ? 'is_active' then (p_profile_patch->>'is_active')::boolean else p.is_active end,
         branch_id = case when p_branch_ids is not null then p_branch_ids[1] else p.branch_id end,
         updated_at = now()
   where p.id = p_target_user_id and p.tenant_id = v_actor_profile.tenant_id
  returning * into v_saved;

  if p_branch_ids is not null then
    delete from public.user_branches ub where ub.user_id = p_target_user_id;
    insert into public.user_branches (user_id, branch_id, granted_by)
    select p_target_user_id, item.branch_id, v_actor
      from unnest(p_branch_ids) with ordinality item(branch_id, position)
     order by item.position;
    v_new_branches := p_branch_ids;
  else
    v_new_branches := v_old_branches;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'update', 'user', p_target_user_id,
    to_jsonb(v_target) || jsonb_build_object('branch_ids', v_old_branches),
    to_jsonb(v_saved) || jsonb_build_object('branch_ids', v_new_branches, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id,
    'branch_ids', v_new_branches,
    'primary_branch_id', v_saved.branch_id
  );
end;
$$;

revoke all on function public.update_managed_user_atomic(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_managed_user_atomic(uuid, jsonb, uuid[]) to authenticated;

select to_regprocedure('public.update_managed_user_atomic(uuid,jsonb,uuid[])') is not null
  as update_managed_user_atomic_ok;


-- ==================== 00280_atomic_managed_user_initialize.sql ====================
-- ============================================================
-- 00280: Atomic managed-user profile and branch initialization
-- ============================================================
-- Definition only. Existing users and branch assignments are not changed.

create or replace function public.initialize_managed_user_atomic(
  p_target_user_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_role_id uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_profile record;
  v_existing record;
  v_saved record;
  v_profile_exists boolean := false;
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_actor_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_actor_profile.role <> 'owner'
     and not (
       public.user_has_permission(v_actor, 'system.create_user')
       or public.user_has_permission(v_actor, 'system.manage_users')
     ) then
    raise exception using errcode = '42501', message = 'CREATE_USER_PERMISSION_REQUIRED';
  end if;
  if p_target_user_id is null or not exists (
    select 1 from auth.users u where u.id = p_target_user_id
  ) then
    raise exception using errcode = '22023', message = 'AUTH_USER_NOT_FOUND';
  end if;
  if v_name is null or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
  end if;
  if length(coalesce(v_email, '')) > 254 or length(coalesce(v_phone, '')) > 32 then
    raise exception using errcode = '22023', message = 'CONTACT_INVALID';
  end if;
  if p_role_id is not null and not exists (
    select 1 from public.roles r
     where r.id = p_role_id and r.tenant_id = v_actor_profile.tenant_id
  ) then
    raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
  end if;
  if p_branch_ids is null
     or cardinality(p_branch_ids) = 0
     or cardinality(p_branch_ids) <> (
       select count(distinct item.branch_id)::integer
         from unnest(p_branch_ids) as item(branch_id)
     )
     or cardinality(p_branch_ids) <> (
       select count(*)::integer
         from public.branches b
        where b.id = any(p_branch_ids)
          and b.tenant_id = v_actor_profile.tenant_id
          and coalesce(b.is_active, true)
     ) then
    raise exception using errcode = '22023', message = 'BRANCH_SCOPE_INVALID';
  end if;

  select p.* into v_existing
    from public.profiles p
   where p.id = p_target_user_id
   for update;
  v_profile_exists := found;
  if v_profile_exists and v_existing.tenant_id <> v_actor_profile.tenant_id then
    raise exception using errcode = '42501', message = 'CROSS_TENANT_TARGET_DENIED';
  end if;
  if v_profile_exists and v_existing.role = 'owner' then
    raise exception using errcode = '42501', message = 'OWNER_PROFILE_CANNOT_BE_INITIALIZED';
  end if;

  if not v_profile_exists then
    insert into public.profiles (
      id, tenant_id, role_id, role, full_name, email, phone,
      branch_id, is_active
    ) values (
      p_target_user_id, v_actor_profile.tenant_id, p_role_id, 'staff',
      v_name, v_email, v_phone, p_branch_ids[1], true
    ) returning * into v_saved;
  else
    update public.profiles p
       set role_id = p_role_id,
           role = 'staff',
           full_name = v_name,
           email = v_email,
           phone = v_phone,
           branch_id = p_branch_ids[1],
           is_active = true,
           updated_at = now()
     where p.id = p_target_user_id
       and p.tenant_id = v_actor_profile.tenant_id
    returning * into v_saved;
  end if;

  delete from public.user_branches ub where ub.user_id = p_target_user_id;
  insert into public.user_branches (user_id, branch_id, granted_by)
  select p_target_user_id, item.branch_id, v_actor
    from unnest(p_branch_ids) with ordinality item(branch_id, position)
   order by item.position;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_actor_profile.tenant_id, v_actor, 'create', 'user', p_target_user_id,
    case when not v_profile_exists then null else to_jsonb(v_existing) end,
    to_jsonb(v_saved) || jsonb_build_object('branch_ids', p_branch_ids, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id,
    'branch_ids', p_branch_ids,
    'primary_branch_id', v_saved.branch_id
  );
end;
$$;

revoke all on function public.initialize_managed_user_atomic(uuid, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.initialize_managed_user_atomic(uuid, text, text, text, uuid, uuid[]) to authenticated;

select to_regprocedure('public.initialize_managed_user_atomic(uuid,text,text,text,uuid,uuid[])') is not null
  as initialize_managed_user_atomic_ok;


-- ==================== 00281_atomic_own_profile_update.sql ====================
-- ============================================================
-- 00281: Atomic own-profile update
-- ============================================================
-- Definition only. Existing profile rows are not changed.

create or replace function public.update_own_profile_atomic(
  p_full_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_old record;
  v_saved record;
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  if v_name is null or length(v_name) > 160 then
    raise exception using errcode = '22023', message = 'FULL_NAME_INVALID';
  end if;
  if v_phone is null or length(v_phone) > 32 then
    raise exception using errcode = '22023', message = 'PHONE_INVALID';
  end if;
  select p.* into v_old
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true)
   for update;
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  update public.profiles p
     set full_name = v_name, phone = v_phone, updated_at = now()
   where p.id = v_actor and p.tenant_id = v_old.tenant_id
  returning * into v_saved;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_old.tenant_id, v_actor, 'update_profile', 'user', v_actor,
    jsonb_build_object('full_name', v_old.full_name, 'phone', v_old.phone),
    jsonb_build_object('full_name', v_saved.full_name, 'phone', v_saved.phone, 'atomic', true)
  );
  return jsonb_build_object(
    'id', v_saved.id, 'full_name', v_saved.full_name, 'phone', v_saved.phone
  );
end;
$$;

revoke all on function public.update_own_profile_atomic(text, text) from public, anon;
grant execute on function public.update_own_profile_atomic(text, text) to authenticated;

select to_regprocedure('public.update_own_profile_atomic(text,text)') is not null
  as update_own_profile_atomic_ok;


-- ==================== 00282_atomic_role_management.sql ====================
-- ============================================================
-- 00282: Atomic role and permission management
-- ============================================================
-- Definition only. Existing roles and permissions are not changed.

create or replace function public.save_role_atomic(
  p_role_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_permission_codes text[] default null
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
  v_old_permissions text[];
  v_new_permissions text[];
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
  if not public.user_has_permission(v_actor, 'system.manage_roles') then
    raise exception using errcode = '42501', message = 'MANAGE_ROLES_PERMISSION_REQUIRED';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_payload) as item(key)
    where item.key not in ('name', 'description', 'color')
  ) then
    raise exception using errcode = '22023', message = 'ROLE_PAYLOAD_INVALID';
  end if;
  if p_role_id is null or p_payload ? 'name' then
    v_name := nullif(trim(coalesce(p_payload->>'name', '')), '');
    if v_name is null or length(v_name) > 120 then
      raise exception using errcode = '22023', message = 'ROLE_NAME_INVALID';
    end if;
  end if;
  if length(coalesce(p_payload->>'description', '')) > 500
     or length(coalesce(p_payload->>'color', '')) > 80 then
    raise exception using errcode = '22023', message = 'ROLE_FIELD_TOO_LONG';
  end if;
  if p_permission_codes is not null and (
    cardinality(p_permission_codes) > 300
    or cardinality(p_permission_codes) <> (
      select count(distinct item.code)::integer
        from unnest(p_permission_codes) as item(code)
    )
    or exists (
      select 1 from unnest(p_permission_codes) as item(code)
      where length(item.code) not between 3 and 120
         or item.code !~ '^[a-z0-9_]+([.][a-z0-9_]+)+$'
    )
  ) then
    raise exception using errcode = '22023', message = 'PERMISSION_CODES_INVALID';
  end if;

  if p_role_id is null then
    insert into public.roles (
      tenant_id, name, description, color, is_system
    ) values (
      v_tenant_id, v_name,
      nullif(trim(coalesce(p_payload->>'description', '')), ''),
      coalesce(nullif(trim(coalesce(p_payload->>'color', '')), ''), 'bg-primary'),
      false
    ) returning * into v_saved;
    v_old_permissions := '{}'::text[];
  else
    select r.* into v_old
      from public.roles r
     where r.id = p_role_id and r.tenant_id = v_tenant_id
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
    end if;
    if v_old.is_system and exists (select 1 from jsonb_object_keys(p_payload)) then
      raise exception using errcode = '22023', message = 'SYSTEM_ROLE_METADATA_LOCKED';
    end if;
    update public.roles r
       set name = case when p_payload ? 'name' then v_name else r.name end,
           description = case when p_payload ? 'description' then nullif(trim(coalesce(p_payload->>'description', '')), '') else r.description end,
           color = case when p_payload ? 'color' then coalesce(nullif(trim(coalesce(p_payload->>'color', '')), ''), 'bg-primary') else r.color end,
           updated_at = now()
     where r.id = p_role_id and r.tenant_id = v_tenant_id
    returning * into v_saved;
    select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}'::text[])
      into v_old_permissions
      from public.role_permissions rp where rp.role_id = p_role_id;
  end if;

  if p_permission_codes is not null then
    delete from public.role_permissions rp where rp.role_id = v_saved.id;
    insert into public.role_permissions (role_id, permission_code)
    select v_saved.id, item.code
      from unnest(p_permission_codes) as item(code)
     order by item.code;
    v_new_permissions := p_permission_codes;
  else
    v_new_permissions := v_old_permissions;
  end if;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor,
    case when p_role_id is null then 'create'
         when p_permission_codes is not null then 'permissions_update'
         else 'update' end,
    'role', v_saved.id,
    case when p_role_id is null then null
         else to_jsonb(v_old) || jsonb_build_object('permissions', v_old_permissions) end,
    to_jsonb(v_saved) || jsonb_build_object('permissions', v_new_permissions, 'atomic', true)
  );
  return to_jsonb(v_saved) || jsonb_build_object('permissions', v_new_permissions);
end;
$$;

create or replace function public.delete_role_atomic(p_role_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_role record;
  v_permissions text[];
  v_member_count integer;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null or not public.user_has_permission(v_actor, 'system.manage_roles') then
    raise exception using errcode = '42501', message = 'MANAGE_ROLES_PERMISSION_REQUIRED';
  end if;
  select r.* into v_role
    from public.roles r
   where r.id = p_role_id and r.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'ROLE_NOT_FOUND';
  end if;
  if v_role.is_system then
    raise exception using errcode = '22023', message = 'SYSTEM_ROLE_CANNOT_DELETE';
  end if;
  select coalesce(array_agg(rp.permission_code order by rp.permission_code), '{}'::text[])
    into v_permissions from public.role_permissions rp where rp.role_id = p_role_id;
  select count(*)::integer into v_member_count
    from public.profiles p
   where p.tenant_id = v_tenant_id and p.role_id = p_role_id;
  update public.profiles p
     set role_id = null, updated_at = now()
   where p.tenant_id = v_tenant_id and p.role_id = p_role_id;
  delete from public.roles r where r.id = p_role_id and r.tenant_id = v_tenant_id;
  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_tenant_id, v_actor, 'delete', 'role', p_role_id,
    to_jsonb(v_role) || jsonb_build_object(
      'permissions', v_permissions, 'unassigned_members', v_member_count
    ),
    jsonb_build_object('deleted', true, 'atomic', true)
  );
  return jsonb_build_object('id', p_role_id, 'unassigned_members', v_member_count);
end;
$$;

revoke all on function public.save_role_atomic(uuid, jsonb, text[]) from public, anon;
grant execute on function public.save_role_atomic(uuid, jsonb, text[]) to authenticated;
revoke all on function public.delete_role_atomic(uuid) from public, anon;
grant execute on function public.delete_role_atomic(uuid) to authenticated;

select
  to_regprocedure('public.save_role_atomic(uuid,jsonb,text[])') is not null as save_role_atomic_ok,
  to_regprocedure('public.delete_role_atomic(uuid)') is not null as delete_role_atomic_ok;


-- ==================== 00283_harden_production_order_lifecycle.sql ====================
-- ============================================================
-- 00283: Harden production-order lifecycle
-- ============================================================
-- Definition only. This migration does not update business data.
--
-- Guarantees:
--   - create order + materials is one transaction;
--   - actor, tenant and branch access are derived server-side;
--   - ordinary status changes cannot bypass complete/cancel stock flows;
--   - complete/cancel require effective permissions and branch access;
--   - cancel never falls back to a status-only update.

create or replace function public.create_production_order_atomic(
  p_input jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_code text;
  v_branch_id uuid;
  v_bom_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_planned_qty numeric;
  v_materials jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;

  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.create_order') then
    raise exception using errcode = '42501', message = 'CREATE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  if p_input is null
     or jsonb_typeof(p_input) <> 'object'
     or exists (
       select 1
         from jsonb_object_keys(p_input) as item(key)
        where item.key not in (
          'branch_id', 'bom_id', 'product_id', 'variant_id', 'planned_qty',
          'planned_start', 'planned_end', 'notes', 'materials'
        )
     ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
  end if;

  begin
    v_branch_id := nullif(p_input->>'branch_id', '')::uuid;
    v_bom_id := nullif(p_input->>'bom_id', '')::uuid;
    v_product_id := nullif(p_input->>'product_id', '')::uuid;
    v_variant_id := nullif(p_input->>'variant_id', '')::uuid;
    v_planned_qty := (p_input->>'planned_qty')::numeric;
  exception when others then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
  end;

  if v_branch_id is null
     or not exists (
       select 1
         from public.branches b
        where b.id = v_branch_id
          and b.tenant_id = v_profile.tenant_id
          and coalesce(b.is_active, true)
     )
     or not public.user_has_branch_access(v_actor, v_branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_planned_qty is null or v_planned_qty <= 0 then
    raise exception using errcode = '22023', message = 'PLANNED_QUANTITY_INVALID';
  end if;
  if nullif(trim(coalesce(p_input->>'notes', '')), '') is not null
     and length(p_input->>'notes') > 2000 then
    raise exception using errcode = '22023', message = 'PRODUCTION_NOTES_TOO_LONG';
  end if;
  if nullif(p_input->>'planned_start', '') is not null
     and nullif(p_input->>'planned_end', '') is not null
     and (p_input->>'planned_end')::date < (p_input->>'planned_start')::date then
    raise exception using errcode = '22023', message = 'PRODUCTION_DATE_RANGE_INVALID';
  end if;

  if not exists (
    select 1
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_profile.tenant_id
       and coalesce(p.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_PRODUCT_NOT_FOUND';
  end if;
  if not exists (
    select 1
      from public.bom b
     where b.id = v_bom_id
       and b.tenant_id = v_profile.tenant_id
       and b.product_id = v_product_id
       and coalesce(b.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_BOM_NOT_FOUND';
  end if;
  if v_variant_id is not null and not exists (
    select 1
      from public.product_variants pv
     where pv.id = v_variant_id
       and pv.tenant_id = v_profile.tenant_id
       and pv.product_id = v_product_id
       and coalesce(pv.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_VARIANT_NOT_FOUND';
  end if;

  v_materials := p_input->'materials';
  if v_materials is null
     or jsonb_typeof(v_materials) <> 'array'
     or jsonb_array_length(v_materials) = 0
     or jsonb_array_length(v_materials) > 500 then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIALS_INVALID';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_materials) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or nullif(item.value->>'product_id', '') is null
        or nullif(trim(coalesce(item.value->>'unit', '')), '') is null
        or length(item.value->>'unit') > 40
        or (item.value->>'planned_qty')::numeric <= 0
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_INVALID';
  end if;
  if (
    select count(*)
      from jsonb_array_elements(v_materials) as item(value)
  ) <> (
    select count(distinct (item.value->>'product_id')::uuid)
      from jsonb_array_elements(v_materials) as item(value)
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_DUPLICATED';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_materials) as item(value)
      left join public.products p
        on p.id = (item.value->>'product_id')::uuid
       and p.tenant_id = v_profile.tenant_id
       and coalesce(p.is_active, true)
     where p.id is null
  ) then
    raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_NOT_FOUND';
  end if;

  v_code := public.next_code(v_profile.tenant_id, 'production_order');

  insert into public.production_orders (
    tenant_id, code, branch_id, bom_id, product_id, variant_id,
    planned_qty, planned_start, planned_end, notes, created_by
  ) values (
    v_profile.tenant_id,
    v_code,
    v_branch_id,
    v_bom_id,
    v_product_id,
    v_variant_id,
    v_planned_qty,
    nullif(p_input->>'planned_start', '')::date,
    nullif(p_input->>'planned_end', '')::date,
    nullif(trim(coalesce(p_input->>'notes', '')), ''),
    v_actor
  )
  returning * into v_order;

  insert into public.production_order_materials (
    production_order_id, product_id, planned_qty, unit, unit_cost
  )
  select
    v_order.id,
    p.id,
    (item.value->>'planned_qty')::numeric,
    trim(item.value->>'unit'),
    coalesce(p.cost_price, 0)
  from jsonb_array_elements(v_materials) as item(value)
  join public.products p
    on p.id = (item.value->>'product_id')::uuid
   and p.tenant_id = v_profile.tenant_id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'create',
    'production_order',
    v_order.id,
    to_jsonb(v_order) || jsonb_build_object(
      'material_count', jsonb_array_length(v_materials),
      'atomic', true
    )
  );

  return jsonb_build_object(
    'id', v_order.id,
    'code', v_order.code,
    'status', v_order.status,
    'branch_id', v_order.branch_id
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'PRODUCTION_INPUT_INVALID';
end;
$$;

create or replace function public.change_production_status_atomic(
  p_production_order_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.complete_order') then
    raise exception using errcode = '42501', message = 'UPDATE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if p_new_status in ('completed', 'cancelled') then
    raise exception using errcode = '22023', message = 'USE_PRODUCTION_STOCK_FLOW';
  end if;

  v_allowed := case v_order.status
    when 'planned' then p_new_status = 'material_check'
    when 'material_check' then p_new_status in ('planned', 'in_production')
    when 'in_production' then p_new_status = 'quality_check'
    when 'quality_check' then p_new_status = 'in_production'
    else false
  end;
  if not v_allowed then
    raise exception using errcode = '22023', message = 'PRODUCTION_STATUS_TRANSITION_INVALID';
  end if;

  update public.production_orders
     set status = p_new_status,
         actual_start = case
           when p_new_status = 'in_production' then coalesce(actual_start, now())
           else actual_start
         end,
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'status_change',
    'production_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object('status', p_new_status, 'atomic', true)
  );

  return jsonb_build_object(
    'id', v_order.id,
    'from_status', v_order.status,
    'status', p_new_status
  );
end;
$$;

create or replace function public.revert_production_materials(
  p_production_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_material record;
  v_reverted_qty numeric(15, 2) := 0;
  v_reverted_cogs numeric(15, 2) := 0;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.cancel_order') then
    raise exception using errcode = '42501', message = 'CANCEL_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_REQUIRED';
  end if;
  if length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'CANCEL_REASON_TOO_LONG';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
    raise exception using errcode = '22023', message = 'PRODUCTION_CANCEL_STATUS_INVALID';
  end if;

  for v_material in
    select pom.id, pom.product_id, pom.actual_qty, pom.unit_cost
      from public.production_order_materials pom
     where pom.production_order_id = v_order.id
       and coalesce(pom.actual_qty, 0) > 0
     for update
  loop
    update public.products p
       set stock = coalesce(p.stock, 0) + v_material.actual_qty
     where p.id = v_material.product_id
       and p.tenant_id = v_profile.tenant_id;
    if not found then
      raise exception using errcode = '22023', message = 'PRODUCTION_MATERIAL_NOT_FOUND';
    end if;

    insert into public.branch_stock (
      tenant_id, branch_id, product_id, variant_id, quantity
    ) values (
      v_profile.tenant_id,
      v_order.branch_id,
      v_material.product_id,
      null,
      v_material.actual_qty
    )
    on conflict (tenant_id, branch_id, product_id) where variant_id is null
    do update
      set quantity = public.branch_stock.quantity + excluded.quantity,
          updated_at = now();

    insert into public.stock_movements (
      tenant_id, branch_id, product_id, type, quantity,
      reference_type, reference_id, note, created_by
    ) values (
      v_profile.tenant_id,
      v_order.branch_id,
      v_material.product_id,
      'in',
      v_material.actual_qty,
      'production_order',
      v_order.id,
      'Huy san xuat: ' || v_order.code || ' - ' || trim(p_reason),
      v_actor
    );

    v_reverted_qty := v_reverted_qty + v_material.actual_qty;
    v_reverted_cogs := v_reverted_cogs
      + coalesce(v_material.unit_cost, 0) * v_material.actual_qty;

    update public.production_order_materials
       set actual_qty = null
     where id = v_material.id;
  end loop;

  update public.production_orders
     set status = 'cancelled',
         cogs_amount = 0,
         notes = concat_ws(
           E'\n',
           nullif(notes, ''),
           '[HUY] ' || trim(p_reason)
         ),
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'cancel',
    'production_order',
    v_order.id,
    jsonb_build_object(
      'status', v_order.status,
      'cogs_amount', coalesce(v_order.cogs_amount, 0)
    ),
    jsonb_build_object(
      'status', 'cancelled',
      'reason', trim(p_reason),
      'reverted_materials_qty', v_reverted_qty,
      'reverted_cogs', v_reverted_cogs,
      'atomic', true
    )
  );

  return jsonb_build_object(
    'order_id', v_order.id,
    'reverted_materials_qty', v_reverted_qty,
    'reverted_cogs', v_reverted_cogs
  );
end;
$$;

create or replace function public.complete_production_atomic(
  p_production_order_id uuid,
  p_completed_qty numeric,
  p_lot_number text default null,
  p_manufactured_date date default current_date,
  p_expiry_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_out_count integer;
  v_lot_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.id, p.tenant_id, p.role
    into v_profile
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'production.complete_order') then
    raise exception using errcode = '42501', message = 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED';
  end if;

  select po.*
    into v_order
    from public.production_orders po
   where po.id = p_production_order_id
     and po.tenant_id = v_profile.tenant_id
   for update;
  if not found then
    raise exception using errcode = '22023', message = 'PRODUCTION_ORDER_NOT_FOUND';
  end if;
  if not public.user_has_branch_access(v_actor, v_order.branch_id) then
    raise exception using errcode = '42501', message = 'PRODUCTION_BRANCH_ACCESS_DENIED';
  end if;
  if v_order.status not in ('planned', 'material_check', 'in_production', 'quality_check') then
    raise exception using errcode = '22023', message = 'PRODUCTION_COMPLETE_STATUS_INVALID';
  end if;
  if p_completed_qty is null
     or p_completed_qty <= 0
     or p_completed_qty > v_order.planned_qty then
    raise exception using errcode = '22023', message = 'COMPLETED_QUANTITY_INVALID';
  end if;
  if p_expiry_date is not null
     and p_manufactured_date is not null
     and p_expiry_date < p_manufactured_date then
    raise exception using errcode = '22023', message = 'PRODUCTION_EXPIRY_DATE_INVALID';
  end if;

  select count(*)
    into v_out_count
    from public.stock_movements sm
   where sm.tenant_id = v_profile.tenant_id
     and sm.reference_id = v_order.id
     and sm.reference_type = 'production_order'
     and sm.type = 'out';
  if v_out_count > 0 then
    raise exception using errcode = '22023', message = 'PRODUCTION_STOCK_RECONCILIATION_REQUIRED';
  end if;

  perform public.consume_production_materials(v_order.id);
  v_lot_id := public.complete_production_order(
    v_order.id,
    p_completed_qty,
    nullif(trim(coalesce(p_lot_number, '')), ''),
    coalesce(p_manufactured_date, current_date),
    p_expiry_date
  );

  insert into public.audit_log (
    tenant_id, user_id, action, entity_type, entity_id, old_data, new_data
  ) values (
    v_profile.tenant_id,
    v_actor,
    'complete',
    'production_order',
    v_order.id,
    jsonb_build_object('status', v_order.status),
    jsonb_build_object(
      'status', 'completed',
      'completed_qty', p_completed_qty,
      'lot_id', v_lot_id,
      'atomic', true
    )
  );

  return v_lot_id;
end;
$$;

revoke all on function public.create_production_order_atomic(jsonb) from public, anon;
grant execute on function public.create_production_order_atomic(jsonb) to authenticated;

revoke all on function public.change_production_status_atomic(uuid, text) from public, anon;
grant execute on function public.change_production_status_atomic(uuid, text) to authenticated;

revoke all on function public.revert_production_materials(uuid, text) from public, anon;
grant execute on function public.revert_production_materials(uuid, text) to authenticated;

revoke all on function public.complete_production_atomic(uuid, numeric, text, date, date)
  from public, anon;
grant execute on function public.complete_production_atomic(uuid, numeric, text, date, date)
  to authenticated;

-- Keep low-level stock functions callable only from trusted server/database code.
revoke all on function public.consume_production_materials(uuid)
  from public, anon, authenticated;
grant execute on function public.consume_production_materials(uuid) to service_role;

revoke all on function public.complete_production_order(uuid, numeric, text, date, date)
  from public, anon, authenticated;
grant execute on function public.complete_production_order(uuid, numeric, text, date, date)
  to service_role;

select
  to_regprocedure('public.create_production_order_atomic(jsonb)') is not null
    as production_create_rpc_ok,
  to_regprocedure('public.change_production_status_atomic(uuid,text)') is not null
    as production_status_rpc_ok,
  to_regprocedure('public.revert_production_materials(uuid,text)') is not null
    as production_cancel_rpc_ok,
  to_regprocedure('public.complete_production_atomic(uuid,numeric,text,date,date)') is not null
    as production_complete_rpc_ok;

notify pgrst, 'reload schema';


commit;

-- Read-only verification for this batch.
with expected(function_name) as (
  values
    ('save_branch_atomic'),
    ('update_branch_settings_atomic'),
    ('patch_tenant_settings_atomic'),
    ('set_branch_print_brand_atomic'),
    ('update_managed_user_atomic'),
    ('initialize_managed_user_atomic'),
    ('update_own_profile_atomic'),
    ('save_role_atomic'),
    ('delete_role_atomic'),
    ('create_production_order_atomic'),
    ('change_production_status_atomic'),
    ('revert_production_materials'),
    ('complete_production_atomic')
), checked as (
  select
    e.function_name,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = e.function_name
    ) as installed
  from expected e
)
select
  count(*) filter (where installed) as installed_count,
  count(*) filter (where not installed) as missing_count,
  coalesce(
    jsonb_agg(function_name order by function_name) filter (where not installed),
    '[]'::jsonb
  ) as missing_functions
from checked;