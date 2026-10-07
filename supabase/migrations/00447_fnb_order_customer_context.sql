-- Additive only: existing orders remain unselected until staff explicitly chooses.
begin;
set local lock_timeout = '2s';
alter table public.kitchen_orders add column if not exists customer_id uuid references public.customers(id);
alter table public.kitchen_orders add column if not exists customer_name text;
alter table public.kitchen_orders add column if not exists customer_selected boolean not null default false;

create or replace function public.fnb_select_order_customer_v1(p_order_id uuid, p_customer_id uuid default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_actor uuid := auth.uid(); v_tenant uuid; v_order public.kitchen_orders; v_name text;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not (public.user_has_permission(v_actor,'pos_fnb.send_kitchen') or public.user_has_permission(v_actor,'pos_fnb.checkout')) then
    raise exception 'CUSTOMER_SELECTION_PERMISSION_DENIED' using errcode='42501';
  end if;
  select * into v_order from public.kitchen_orders where id=p_order_id and tenant_id=v_tenant for update;
  if not found or not public.user_has_branch_access(v_actor,v_order.branch_id) then
    raise exception 'ORDER_ACCESS_DENIED' using errcode='42501';
  end if;
  if v_order.invoice_id is not null or v_order.merged_into_id is not null or v_order.status not in ('pending','preparing','ready','served') then
    raise exception 'ORDER_NOT_UNPAID' using errcode='P0001';
  end if;
  v_name := 'Khách lẻ';
  if p_customer_id is not null then
    select name into v_name from public.customers where id=p_customer_id and tenant_id=v_tenant and coalesce(is_active,true);
    if not found then raise exception 'CUSTOMER_NOT_IN_TENANT' using errcode='42501'; end if;
  end if;
  update public.kitchen_orders set customer_id=p_customer_id, customer_name=v_name, customer_selected=true, updated_at=now() where id=p_order_id;
end $$;
revoke all on function public.fnb_select_order_customer_v1(uuid,uuid) from public,anon;
grant execute on function public.fnb_select_order_customer_v1(uuid,uuid) to authenticated;

-- Keep the existing atomic catalog/branch/idempotency guards and attach customer
-- in the same transaction. A retry never rewrites a later cashier selection.
create or replace function public.fnb_send_to_kitchen_with_customer_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_result jsonb; v_order public.kitchen_orders;
begin
  if coalesce((p_request->>'customer_selected')::boolean,false) is not true then
    raise exception 'CUSTOMER_SELECTION_REQUIRED' using errcode='P0001';
  end if;
  v_result := public.fnb_send_to_kitchen_atomic_v2(
    p_branch_id := (p_request->>'p_branch_id')::uuid,
    p_table_id := (p_request->>'p_table_id')::uuid,
    p_order_type := p_request->>'p_order_type',
    p_note := p_request->>'p_note',
    p_idempotency_key := p_request->>'p_idempotency_key',
    p_items := p_request->'p_items',
    p_delivery_platform := p_request->>'p_delivery_platform',
    p_delivery_fee := (p_request->>'p_delivery_fee')::numeric,
    p_platform_commission_percent := (p_request->>'p_platform_commission_percent')::numeric,
    p_delivery_staff_id := (p_request->>'p_delivery_staff_id')::uuid,
    p_delivery_distance_tier := p_request->>'p_delivery_distance_tier'
  );
  select * into v_order from public.kitchen_orders where id=(v_result->>'kitchen_order_id')::uuid for update;
  if not v_order.customer_selected then
    perform public.fnb_select_order_customer_v1(v_order.id,(p_request->>'customer_id')::uuid);
  end if;
  return v_result;
end $$;
revoke all on function public.fnb_send_to_kitchen_with_customer_v1(jsonb) from public,anon;
grant execute on function public.fnb_send_to_kitchen_with_customer_v1(jsonb) to authenticated;

-- Split children inherit the explicit choice. Merging different or unknown
-- customers clears the target context so staff must choose the correct guest.
create or replace function public.fnb_inherit_order_customer_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent public.kitchen_orders; v_target public.kitchen_orders;
begin
  if TG_OP='INSERT' then
    if new.parent_order_id is not null then
      select * into v_parent from public.kitchen_orders where id=new.parent_order_id and tenant_id=new.tenant_id and branch_id=new.branch_id;
      if found then new.customer_id:=v_parent.customer_id; new.customer_name:=v_parent.customer_name; new.customer_selected:=v_parent.customer_selected; end if;
    end if;
    return new;
  end if;
  if new.merged_into_id is not null and old.merged_into_id is distinct from new.merged_into_id then
    select * into v_target from public.kitchen_orders where id=new.merged_into_id and tenant_id=new.tenant_id and branch_id=new.branch_id for update;
    if found and not (new.customer_selected and v_target.customer_selected and new.customer_id is not distinct from v_target.customer_id) then
      update public.kitchen_orders set customer_id=null,customer_name=null,customer_selected=false,updated_at=now() where id=v_target.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fnb_inherit_order_customer_context() from public,anon,authenticated;
drop trigger if exists fnb_inherit_order_customer_insert on public.kitchen_orders;
create trigger fnb_inherit_order_customer_insert before insert on public.kitchen_orders for each row execute function public.fnb_inherit_order_customer_context();
drop trigger if exists fnb_inherit_order_customer_merge on public.kitchen_orders;
create trigger fnb_inherit_order_customer_merge after update of merged_into_id on public.kitchen_orders for each row execute function public.fnb_inherit_order_customer_context();
notify pgrst, 'reload schema';
commit;
