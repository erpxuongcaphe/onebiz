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
