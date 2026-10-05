-- Preserve every existing rank and rule. Common order is an explicit opt-in.
begin;
alter table public.product_modifier_groups add column if not exists use_common_order boolean not null default false;
alter table public.category_modifier_groups add column if not exists use_common_order boolean not null default false;

create or replace function public.save_fnb_modifier_links_atomic(
  p_target text, p_target_id uuid, p_group_ids uuid[], p_use_common_order boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := auth.uid(); v_tenant uuid; v_ids uuid[] := coalesce(p_group_ids,'{}'::uuid[]);
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  if v_tenant is null or not public.user_has_permission(v_actor,'products.edit') then
    raise exception using errcode='42501',message='MODIFIER_ORDER_PERMISSION_DENIED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':fnb-modifier-order',0));
  if p_target='product' then
    perform 1 from public.products where id=p_target_id and tenant_id=v_tenant and product_type='sku' and channel='fnb' for update;
  elsif p_target='category' then
    perform 1 from public.categories where id=p_target_id and tenant_id=v_tenant and scope='sku' and channel='fnb' for update;
  else raise exception 'MODIFIER_ORDER_TARGET_INVALID'; end if;
  if not found then raise exception 'MODIFIER_ORDER_TARGET_INVALID'; end if;
  if array_position(v_ids,null) is not null or cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) t(id)) then
    raise exception 'MODIFIER_ORDER_INVALID';
  end if;
  perform 1 from public.modifier_groups where tenant_id=v_tenant and id=any(v_ids) order by id for update;
  if cardinality(v_ids)<>(select count(*) from public.modifier_groups where tenant_id=v_tenant and id=any(v_ids) and is_active and channel in ('fnb','all')) then
    raise exception 'MODIFIER_ORDER_GROUP_INVALID';
  end if;
  if p_target='product' then
    delete from public.product_modifier_groups where tenant_id=v_tenant and product_id=p_target_id and not(modifier_group_id=any(v_ids));
    insert into public.product_modifier_groups(tenant_id,product_id,modifier_group_id,sort_order,use_common_order)
      select v_tenant,p_target_id,id,ordinality::integer-1,coalesce(p_use_common_order,false) from unnest(v_ids) with ordinality t(id,ordinality)
      on conflict(product_id,modifier_group_id) do update set sort_order=excluded.sort_order,use_common_order=excluded.use_common_order;
    -- Existing rule_override and link identity are deliberately retained.
  else
    delete from public.category_modifier_groups where tenant_id=v_tenant and category_id=p_target_id and not(modifier_group_id=any(v_ids));
    insert into public.category_modifier_groups(tenant_id,category_id,modifier_group_id,sort_order,use_common_order)
      select v_tenant,p_target_id,id,ordinality::integer-1,coalesce(p_use_common_order,false) from unnest(v_ids) with ordinality t(id,ordinality)
      on conflict(category_id,modifier_group_id) do update set sort_order=excluded.sort_order,use_common_order=excluded.use_common_order;
  end if;
  return jsonb_build_object('success',true,'count',cardinality(v_ids));
end;
$function$;

create or replace function public.save_fnb_modifier_display_order_atomic(
  p_kind text, p_parent_id uuid, p_ids uuid[], p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $function$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_current jsonb; v_ids uuid[]:=coalesce(p_ids,'{}'::uuid[]);
begin
  if v_actor is null then raise exception using errcode='42501',message='AUTH_REQUIRED'; end if;
  select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
  if v_tenant is null or not public.user_has_permission(v_actor,'products.edit') then raise exception using errcode='42501',message='MODIFIER_ORDER_PERMISSION_DENIED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':fnb-modifier-order',0));
  if p_kind='groups' then
    perform 1 from public.modifier_groups where tenant_id=v_tenant and is_active order by id for update;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'sort_order',sort_order) order by id),'[]'::jsonb) into v_current from public.modifier_groups where tenant_id=v_tenant and is_active;
  elsif p_kind='options' then
    perform 1 from public.modifier_groups where id=p_parent_id and tenant_id=v_tenant and is_active for update;
    if not found then raise exception 'MODIFIER_ORDER_GROUP_INVALID'; end if;
    perform 1 from public.modifier_options where group_id=p_parent_id and is_active order by id for update;
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'sort_order',sort_order) order by id),'[]'::jsonb) into v_current from public.modifier_options where group_id=p_parent_id and is_active;
  else raise exception 'MODIFIER_ORDER_INVALID'; end if;
  if p_snapshot is distinct from v_current then raise exception 'MODIFIER_ORDER_CONFLICT'; end if;
  if array_position(v_ids,null) is not null or cardinality(v_ids)<>jsonb_array_length(v_current)
    or cardinality(v_ids)<>(select count(distinct id) from unnest(v_ids) t(id))
    or exists(select 1 from unnest(v_ids) t(id) where not exists(select 1 from jsonb_array_elements(v_current) c where c->>'id'=t.id::text)) then
    raise exception 'MODIFIER_ORDER_INVALID';
  end if;
  if p_kind='groups' then
    update public.modifier_groups g set sort_order=t.ordinality::integer-1,updated_at=now()
      from unnest(v_ids) with ordinality t(id,ordinality) where g.id=t.id and g.tenant_id=v_tenant;
  else
    update public.modifier_options o set sort_order=t.ordinality::integer-1
      from unnest(v_ids) with ordinality t(id,ordinality) where o.id=t.id and o.group_id=p_parent_id;
  end if;
  return jsonb_build_object('success',true);
end;
$function$;

revoke all on function public.save_fnb_modifier_links_atomic(text,uuid,uuid[],boolean) from public,anon;
revoke all on function public.save_fnb_modifier_display_order_atomic(text,uuid,uuid[],jsonb) from public,anon;
grant execute on function public.save_fnb_modifier_links_atomic(text,uuid,uuid[],boolean) to authenticated;
grant execute on function public.save_fnb_modifier_display_order_atomic(text,uuid,uuid[],jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
