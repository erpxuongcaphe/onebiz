-- Shared FnB display ordering; no prices, stock, recipes or orders are changed.
begin;
create or replace function public.save_fnb_menu_order_atomic(
  p_original jsonb, p_category_ids uuid[], p_product_ids uuid[]
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_products integer;
  v_categories integer;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select tenant_id into v_tenant from public.profiles where id = v_actor and is_active;
  if v_tenant is null or not public.user_has_permission(v_actor, 'products.edit') then
    raise exception 'MENU_ORDER_PERMISSION_DENIED' using errcode = '42501';
  end if;
  -- Serialise menu editors; row locks also coordinate direct product/category edits.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':fnb-menu-order', 0));
  perform id from public.products where tenant_id = v_tenant and channel = 'fnb'
    and product_type = 'sku' and is_active and allow_sale order by id for update;
  perform c.id from public.categories c where c.tenant_id = v_tenant and c.scope = 'sku'
    and exists (select 1 from public.products p where p.tenant_id = v_tenant and p.category_id = c.id
      and p.channel = 'fnb' and p.product_type = 'sku' and p.is_active and p.allow_sale)
    order by c.id for update;

  if p_category_ids is null or p_product_ids is null or p_original is null
     or jsonb_typeof(p_original->'categories') is distinct from 'array'
     or jsonb_typeof(p_original->'products') is distinct from 'array'
     or array_position(p_category_ids, null) is not null or array_position(p_product_ids, null) is not null
     or cardinality(p_category_ids) <> (select count(distinct x) from unnest(p_category_ids) x)
     or cardinality(p_product_ids) <> (select count(distinct x) from unnest(p_product_ids) x) then
    raise exception 'MENU_ORDER_INVALID';
  end if;
  select count(*) into v_products from public.products where tenant_id = v_tenant
    and channel = 'fnb' and product_type = 'sku' and is_active and allow_sale;
  select count(*) into v_categories from public.categories c where c.tenant_id = v_tenant and c.scope = 'sku'
    and exists (select 1 from public.products p where p.tenant_id = v_tenant and p.category_id = c.id
      and p.channel = 'fnb' and p.product_type = 'sku' and p.is_active and p.allow_sale);
  if cardinality(p_product_ids) <> v_products or cardinality(p_category_ids) <> v_categories
     or jsonb_array_length(p_original->'products') <> v_products
     or jsonb_array_length(p_original->'categories') <> v_categories then
    raise exception 'MENU_ORDER_CONFLICT';
  end if;
  -- Compare every row in the original snapshot, including ranks tied at zero.
  if v_products <> (select count(distinct p.id) from public.products p
      join jsonb_to_recordset(p_original->'products') as o(id uuid, name text, sort_order integer, category_id uuid)
        on o.id = p.id and o.name = p.name and o.sort_order is not distinct from p.sort_order
          and o.category_id is not distinct from p.category_id
      where p.tenant_id = v_tenant and p.channel = 'fnb' and p.product_type = 'sku' and p.is_active and p.allow_sale
        and p.id = any(p_product_ids))
     or v_categories <> (select count(distinct c.id) from public.categories c
       join jsonb_to_recordset(p_original->'categories') as o(id uuid, name text, sort_order integer)
         on o.id = c.id and o.name = c.name and o.sort_order is not distinct from c.sort_order
       where c.tenant_id = v_tenant and c.scope = 'sku' and c.id = any(p_category_ids)
         and exists (select 1 from public.products p where p.tenant_id = v_tenant and p.category_id = c.id
           and p.channel = 'fnb' and p.product_type = 'sku' and p.is_active and p.allow_sale)) then
    raise exception 'MENU_ORDER_CONFLICT';
  end if;
  update public.categories c set sort_order = selected.ordinality::integer
    from unnest(p_category_ids) with ordinality selected(id, ordinality)
    where c.id = selected.id and c.tenant_id = v_tenant;
  update public.products p set sort_order = selected.rank::integer
    from (select ordered.id, row_number() over (partition by product.category_id order by ordered.ordinality) as rank
      from unnest(p_product_ids) with ordinality ordered(id, ordinality)
      join public.products product on product.id = ordered.id and product.tenant_id = v_tenant) selected
    where p.id = selected.id and p.tenant_id = v_tenant;
end;
$$;
revoke all on function public.save_fnb_menu_order_atomic(jsonb,uuid[],uuid[]) from public, anon;
grant execute on function public.save_fnb_menu_order_atomic(jsonb,uuid[],uuid[]) to authenticated;

create or replace function public.get_fnb_menu_order_revision() returns text
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_products jsonb; v_categories jsonb;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select tenant_id into v_tenant from public.profiles where id = v_actor and is_active;
  if v_tenant is null or not (public.user_has_permission(v_actor, 'pos_fnb.send_kitchen')
      or public.user_has_permission(v_actor, 'products.edit')) then
    raise exception 'MENU_ORDER_PERMISSION_DENIED' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(p.id, p.category_id, p.sort_order, p.name) order by p.id), '[]'::jsonb)
    into v_products from public.products p where p.tenant_id = v_tenant and p.channel = 'fnb'
      and p.product_type = 'sku' and p.is_active and p.allow_sale;
  select coalesce(jsonb_agg(jsonb_build_array(c.id, c.sort_order, c.name) order by c.id), '[]'::jsonb)
    into v_categories from public.categories c where c.tenant_id = v_tenant and c.scope = 'sku'
      and exists (select 1 from public.products p where p.tenant_id = v_tenant and p.category_id = c.id
        and p.channel = 'fnb' and p.product_type = 'sku' and p.is_active and p.allow_sale);
  return md5(v_products::text || v_categories::text);
end;
$$;
revoke all on function public.get_fnb_menu_order_revision() from public, anon;
grant execute on function public.get_fnb_menu_order_revision() to authenticated;
commit;
