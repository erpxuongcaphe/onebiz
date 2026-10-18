-- Presentation only. Existing shared catalog, BOM, stock and paid documents are untouched.
begin;
create table public.fnb_pos_menu_layouts (
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid primary key references public.branches(id),
 revision bigint not null default 1 check(revision > 0),
 category_ids uuid[] not null default '{}', product_ids uuid[] not null default '{}', hidden_ids uuid[] not null default '{}',
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now()
);
alter table public.fnb_pos_menu_layouts enable row level security;
revoke all on public.fnb_pos_menu_layouts from public, anon, authenticated;

create function public.get_fnb_pos_menu_layout(p_branch_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; result jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
  or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
  or not (coalesce(public.user_has_permission(actor,'pos_fnb.send_kitchen'),false) or coalesce(public.user_has_permission(actor,'products.edit'),false))
 then raise exception 'MENU_LAYOUT_PERMISSION_DENIED' using errcode='42501'; end if;
 select jsonb_build_object('revision',revision,'categoryIds',category_ids,'productIds',product_ids,'hiddenIds',hidden_ids)
 into result from public.fnb_pos_menu_layouts where branch_id=p_branch_id and tenant_id=tenant;
 return coalesce(result,jsonb_build_object('revision',0,'categoryIds','[]'::jsonb,'productIds','[]'::jsonb,'hiddenIds','[]'::jsonb));
end $$;

create function public.save_fnb_pos_menu_layout(p_branch_id uuid,p_revision bigint,p_category_ids uuid[],p_product_ids uuid[],p_hidden_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; current_revision bigint;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not coalesce(public.user_has_permission(actor,'products.edit'),false)
  or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
  or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
 then raise exception 'MENU_LAYOUT_PERMISSION_DENIED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_branch_id::text||':fnb-pos-layout',0));
 select revision into current_revision from public.fnb_pos_menu_layouts where branch_id=p_branch_id and tenant_id=tenant for update;
 if p_revision is distinct from coalesce(current_revision,0) then raise exception 'MENU_LAYOUT_CONFLICT'; end if;
 if p_product_ids is null or p_category_ids is null or p_hidden_ids is null
  or cardinality(p_product_ids)>5000 or cardinality(p_category_ids)>1000 or cardinality(p_hidden_ids)>5000
  or array_position(p_product_ids,null) is not null or array_position(p_category_ids,null) is not null or array_position(p_hidden_ids,null) is not null
  or cardinality(p_product_ids)<>(select count(distinct x) from unnest(p_product_ids) x)
  or cardinality(p_category_ids)<>(select count(distinct x) from unnest(p_category_ids) x)
  or cardinality(p_hidden_ids)<>(select count(distinct x) from unnest(p_hidden_ids) x)
  or not p_hidden_ids <@ p_product_ids
 then raise exception 'MENU_LAYOUT_INVALID'; end if;
 -- Availability remains authoritative; layout cannot expose an inactive or another branch's product.
 if exists(select 1 from unnest(p_product_ids) x where not exists(
  select 1 from public.products p where p.id=x and p.tenant_id=tenant and p.is_active and p.allow_sale
   and p.channel='fnb' and p.product_type='sku' and p.inventory_role='fnb_menu_item'
   and (not exists(select 1 from public.fnb_product_branch_menu_scopes s where s.product_id=p.id and s.tenant_id=tenant)
    or case coalesce((select mode from public.fnb_product_branch_menu_policies m where m.product_id=p.id and m.tenant_id=tenant),'only')
     when 'except' then not exists(select 1 from public.fnb_product_branch_menu_scopes s where s.product_id=p.id and s.tenant_id=tenant and s.branch_id=p_branch_id)
     else exists(select 1 from public.fnb_product_branch_menu_scopes s where s.product_id=p.id and s.tenant_id=tenant and s.branch_id=p_branch_id) end)))
  or exists(select 1 from unnest(p_category_ids) x where not exists(select 1 from public.categories c where c.id=x and c.tenant_id=tenant and c.scope='sku'))
 then raise exception 'MENU_LAYOUT_INVALID'; end if;
 insert into public.fnb_pos_menu_layouts(tenant_id,branch_id,revision,category_ids,product_ids,hidden_ids,updated_by)
 values(tenant,p_branch_id,coalesce(current_revision,0)+1,p_category_ids,p_product_ids,p_hidden_ids,actor)
 on conflict(branch_id) do update set revision=excluded.revision,category_ids=excluded.category_ids,
  product_ids=excluded.product_ids,hidden_ids=excluded.hidden_ids,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 return public.get_fnb_pos_menu_layout(p_branch_id);
end $$;

-- One canonical order for both POS and the floor-plan editor, isolated by branch and floor.
create function public.reorder_fnb_floor_zones_atomic(p_branch_id uuid,p_floor integer,p_original uuid[],p_ids uuid[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; actual uuid[];
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=tenant)
  or not coalesce(public.user_has_branch_access(actor,p_branch_id),false)
  or not (coalesce(public.user_has_permission(actor,'floor_plan.edit_global'),false) or coalesce(public.user_has_permission(actor,'floor_plan.edit_branch'),false))
 then raise exception 'FLOOR_PLAN_PERMISSION_DENIED' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_branch_id::text||':floor-zone-order',0));
 perform id from public.floor_plan_zones where tenant_id=tenant and branch_id=p_branch_id and floor_level=p_floor and is_active order by id for update;
 select coalesce(array_agg(id order by sort_order,id),'{}') into actual from public.floor_plan_zones where tenant_id=tenant and branch_id=p_branch_id and floor_level=p_floor and is_active;
 if p_original is distinct from actual then raise exception 'FLOOR_ORDER_CONFLICT'; end if;
 if p_ids is null or cardinality(p_ids)<>cardinality(actual) or array_position(p_ids,null) is not null
  or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x) or not p_ids <@ actual then raise exception 'FLOOR_ORDER_INVALID'; end if;
 update public.floor_plan_zones z set sort_order=x.rank::integer,updated_at=clock_timestamp()
 from unnest(p_ids) with ordinality x(id,rank) where z.id=x.id and z.tenant_id=tenant and z.branch_id=p_branch_id;
end $$;
revoke all on function public.get_fnb_pos_menu_layout(uuid),public.save_fnb_pos_menu_layout(uuid,bigint,uuid[],uuid[],uuid[]),public.reorder_fnb_floor_zones_atomic(uuid,integer,uuid[],uuid[]) from public,anon;
grant execute on function public.get_fnb_pos_menu_layout(uuid),public.save_fnb_pos_menu_layout(uuid,bigint,uuid[],uuid[],uuid[]),public.reorder_fnb_floor_zones_atomic(uuid,integer,uuid[],uuid[]) to authenticated;
commit;
