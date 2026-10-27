begin;
set local lock_timeout = '2s';

-- Read-only quotes. A quote never creates stock, changes a price or enables a scope.
create function public.get_inventory_opening_warehouse_prices(p_branch_id uuid, p_product_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(v_actor,'inventory.adjust')
    or not public.user_has_branch_access(v_actor,p_branch_id) then
    raise exception 'OPENING_PERMISSION_DENIED' using errcode='42501';
  end if;
  if not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant and is_active and branch_type='store')
    or not public._fnb_branch_cost_tracking_enabled_00390(v_tenant,p_branch_id) then
    raise exception 'OPENING_FNB_SETUP_REQUIRED';
  end if;
  if coalesce(cardinality(p_product_ids),0) not between 1 and 1000 or array_position(p_product_ids,null) is not null then
    raise exception 'OPENING_ROWS_LIMIT';
  end if;
  if (select count(*) from public.products where tenant_id=v_tenant and id=any(p_product_ids) and is_active
      and product_type='sku' and channel is distinct from 'fnb' and inventory_role is distinct from 'fnb_menu_item')
      <> (select count(distinct id) from unnest(p_product_ids) id) then
    raise exception 'OPENING_PRODUCT_NOT_FOUND';
  end if;
  return (select jsonb_agg(jsonb_build_object('productId',id,'unit',unit,
    'costPrice',case when sell_price>0 then round(sell_price,6) else null end))
    from public.products where tenant_id=v_tenant and id=any(p_product_ids));
end; $$;

create function public.get_fnb_new_store_cost_default()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(v_actor,'system.manage_branches')
    or not public.user_has_permission(v_actor,'products.edit') then
    raise exception 'FNB_SUPPLY_PERMISSION_DENIED' using errcode='42501';
  end if;
  return coalesce((select value from public.tenant_settings where tenant_id=v_tenant and key='fnb_new_store_cost_default'),
    '{"enabled":false,"templateBranchId":null}'::jsonb);
end; $$;

create function public.set_fnb_new_store_cost_default(p_enabled boolean,p_template_branch_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_value jsonb; v_old jsonb;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(v_actor,'system.manage_branches')
    or not public.user_has_permission(v_actor,'products.edit') then
    raise exception 'FNB_SUPPLY_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_enabled is null or nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'FNB_DEFAULT_INPUT_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-supply:'||v_tenant::text,0));
  if p_enabled and not exists(select 1 from public.branches b join public.fnb_supply_branch_scopes s
    on s.branch_id=b.id and s.tenant_id=b.tenant_id and s.enforcement_enabled
    where b.id=p_template_branch_id and b.tenant_id=v_tenant and b.branch_type='store' and b.is_active
    and public.user_has_branch_access(v_actor,b.id) and exists(select 1 from public.fnb_supply_catalog c
      join public.products p on p.id=c.product_id and p.tenant_id=c.tenant_id
      where c.tenant_id=v_tenant and c.branch_id=b.id and p.is_active and p.product_type='sku'
        and p.channel is distinct from 'fnb' and p.inventory_role is distinct from 'fnb_menu_item')) then
    raise exception 'FNB_DEFAULT_TEMPLATE_REQUIRED';
  end if;
  select value into v_old from public.tenant_settings where tenant_id=v_tenant and key='fnb_new_store_cost_default' for update;
  v_value:=jsonb_build_object('enabled',p_enabled,'templateBranchId',case when p_enabled then p_template_branch_id else null end);
  insert into public.tenant_settings(tenant_id,key,value,description,updated_by)
  values(v_tenant,'fnb_new_store_cost_default',v_value,'Sổ giá vốn F&B riêng cho cửa hàng tạo mới',v_actor)
  on conflict(tenant_id,key) do update set value=excluded.value,updated_by=v_actor,updated_at=now();
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
  values(v_tenant,v_actor,'fnb_new_store_cost_default','tenant',v_tenant,v_old,v_value||jsonb_build_object('reason',trim(p_reason)));
  return v_value;
end; $$;

-- Opt-in per tenant, future inserts only. No existing branch, stock or bill is changed.
create function public._initialize_fnb_new_store_cost_default()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_policy jsonb; v_template uuid; v_actor uuid:=auth.uid(); v_count integer;
begin
  if new.branch_type is distinct from 'store' or new.cascade_mode is distinct from 'outlet' or not new.is_active then return new; end if;
  select value into v_policy from public.tenant_settings where tenant_id=new.tenant_id and key='fnb_new_store_cost_default';
  if coalesce(v_policy->>'enabled','false')<>'true' then return new; end if;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and tenant_id=new.tenant_id and coalesce(is_active,true))
    or not public.user_has_permission(v_actor,'system.manage_branches') then
    raise exception 'FNB_SUPPLY_PERMISSION_DENIED' using errcode='42501';
  end if;
  v_template:=(v_policy->>'templateBranchId')::uuid;
  if not exists(select 1 from public.branches b join public.fnb_supply_branch_scopes s
    on s.branch_id=b.id and s.tenant_id=b.tenant_id and s.enforcement_enabled
    where b.id=v_template and b.tenant_id=new.tenant_id and b.branch_type='store' and b.is_active) then
    raise exception 'FNB_DEFAULT_TEMPLATE_REQUIRED';
  end if;
  with added as (
    insert into public.fnb_supply_catalog(tenant_id,branch_id,product_id,created_by)
    select new.tenant_id,new.id,c.product_id,v_actor from public.fnb_supply_catalog c join public.products p
      on p.id=c.product_id and p.tenant_id=c.tenant_id
    where c.tenant_id=new.tenant_id and c.branch_id=v_template and p.is_active and p.product_type='sku'
      and p.channel is distinct from 'fnb' and p.inventory_role is distinct from 'fnb_menu_item'
    on conflict do nothing returning product_id
  ) insert into public.fnb_supply_catalog_audit(tenant_id,branch_id,product_id,action,actor_id)
    select new.tenant_id,new.id,product_id,'add',v_actor from added;
  get diagnostics v_count=row_count;
  if v_count=0 then raise exception 'FNB_SUPPLY_CATALOG_EMPTY'; end if;
  insert into public.fnb_supply_branch_scopes(tenant_id,branch_id,enforcement_enabled,updated_by,note)
  values(new.tenant_id,new.id,true,v_actor,'Tự thiết lập sổ giá vốn theo mặc định cửa hàng mới');
  insert into public.fnb_supply_branch_scope_audit(tenant_id,branch_id,enforcement_enabled,note,actor_id)
  values(new.tenant_id,new.id,true,'Tự thiết lập; chỉ sao chép danh mục cấp hàng, không sao chép tồn hay giá vốn',v_actor);
  return new;
end; $$;

revoke all on function public._initialize_fnb_new_store_cost_default() from public,anon,authenticated;
revoke all on function public.get_inventory_opening_warehouse_prices(uuid,uuid[]),public.get_fnb_new_store_cost_default(),
  public.set_fnb_new_store_cost_default(boolean,uuid,text) from public,anon,authenticated;
grant execute on function public.get_inventory_opening_warehouse_prices(uuid,uuid[]),public.get_fnb_new_store_cost_default(),
  public.set_fnb_new_store_cost_default(boolean,uuid,text) to authenticated;
create trigger initialize_fnb_new_store_cost_default after insert on public.branches
for each row execute function public._initialize_fnb_new_store_cost_default();
notify pgrst,'reload schema';
commit;
