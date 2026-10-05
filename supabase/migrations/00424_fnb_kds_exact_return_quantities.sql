begin;
set local lock_timeout = '3s';

-- Private projection shared by KDS reads and existing readiness guards.
create or replace function public._fnb_kitchen_remaining_00424(p_item_id uuid)
returns numeric language sql stable set search_path = public, extensions as $$
  select greatest(least(
    greatest(koi.quantity - coalesce(koi.cancelled_qty, 0), 0),
    coalesce(ii.quantity - least(ii.quantity, greatest(ii.returned_qty, 0)), koi.quantity)
  ), 0)
  from public.kitchen_order_items koi
  join public.kitchen_orders ko on ko.id = koi.kitchen_order_id
  left join public.fnb_invoice_kitchen_line_sources s on s.kitchen_order_item_id = koi.id
  left join public.invoice_items ii on ii.id = s.invoice_item_id
    and ii.invoice_id = ko.invoice_id
    and exists (select 1 from public.invoices i where i.id = ii.invoice_id
      and i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id
      and i.source = 'fnb' and i.status = 'completed')
  where koi.id = p_item_id;
$$;
revoke all on function public._fnb_kitchen_remaining_00424(uuid) from public, anon, authenticated;

create or replace function public.fnb_kitchen_return_lines(p_branch_id uuid)
returns table(kitchen_order_id uuid, kitchen_order_item_id uuid, remaining_quantity numeric, returned_quantity numeric)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
begin
  if v_actor is null then raise exception 'UNAUTHENTICATED' using errcode = 'P0001'; end if;
  select p.tenant_id into v_tenant_id from public.profiles p
    where p.id = v_actor and coalesce(p.is_active, true);
  if not found or v_tenant_id is null then
    raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
  end if;
  if not coalesce(public.user_has_permission(v_actor, 'pos_fnb.view_orders'), false) then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;
  if p_branch_id is null or not coalesce(public.user_has_branch_access(v_actor, p_branch_id), false) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;
  return query
    select ko.id, koi.id, public._fnb_kitchen_remaining_00424(koi.id),
      least(ii.quantity, greatest(coalesce(ii.returned_qty, 0), 0))
    from public.kitchen_orders ko
    join public.kitchen_order_items koi on koi.kitchen_order_id = ko.id
    join public.fnb_invoice_kitchen_line_sources s on s.kitchen_order_item_id = koi.id
    join public.invoice_items ii on ii.id = s.invoice_item_id and ii.invoice_id = ko.invoice_id
    join public.invoices i on i.id = ii.invoice_id and i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id
    where ko.tenant_id = v_tenant_id and ko.branch_id = p_branch_id
      and ko.status in ('pending', 'preparing', 'ready')
      and i.source = 'fnb' and i.status = 'completed';
end;
$$;
revoke all on function public.fnb_kitchen_return_lines(uuid) from public, anon;
grant execute on function public.fnb_kitchen_return_lines(uuid) to authenticated;

-- Patch only the quantity predicates; permission, transitions and audit remain unchanged.
do $$
declare
  v_signature text;
  v_definition text;
  v_anchor text;
  v_expected integer;
begin
  foreach v_signature in array array[
    'public.fnb_update_kitchen_item_status_v2(uuid,text)',
    'public.fnb_update_kitchen_order_status_v2(uuid,text)'
  ] loop
    v_definition := pg_get_functiondef(v_signature::regprocedure);
    if v_signature like '%item_status%' then
      v_anchor := 'greatest(x.quantity - coalesce(x.cancelled_qty, 0), 0) > 0';
      v_expected := 2;
    else
      v_anchor := 'greatest(koi.quantity - coalesce(koi.cancelled_qty, 0), 0) > 0';
      v_expected := 1;
    end if;
    if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> v_expected then
      raise exception 'FNB_00424_GUARD_SHAPE_CHANGED:%', v_signature;
    end if;
    v_definition := replace(v_definition, v_anchor,
      case when v_expected = 2 then 'public._fnb_kitchen_remaining_00424(x.id) > 0'
      else 'public._fnb_kitchen_remaining_00424(koi.id) > 0' end);
    if v_expected = 2 then
      v_anchor := '  update public.kitchen_order_items';
      if (length(v_definition) - length(replace(v_definition, v_anchor, ''))) / length(v_anchor) <> 1 then
        raise exception 'FNB_00424_ITEM_UPDATE_SHAPE_CHANGED';
      end if;
      v_definition := replace(v_definition, v_anchor,
        E'  if public._fnb_kitchen_remaining_00424(p_item_id) <= 0 then\n    raise exception ''KITCHEN_ITEM_NO_REMAINING_QUANTITY'' using errcode = ''P0001'';\n  end if;\n\n' || v_anchor);
    end if;
    execute v_definition;
  end loop;
end;
$$;

-- Notify only active FNB parent orders; no invoice, cash, stock or Retail rewrites.
create or replace function public.fnb_touch_kitchen_return_00424()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.returned_qty is distinct from old.returned_qty then
    update public.kitchen_orders ko set updated_at = now()
    where ko.invoice_id = new.invoice_id and ko.status in ('pending', 'preparing', 'ready')
      and exists (select 1 from public.invoices i where i.id = new.invoice_id
        and i.source = 'fnb' and i.tenant_id = ko.tenant_id and i.branch_id = ko.branch_id);
  end if;
  return new;
end;
$$;
revoke all on function public.fnb_touch_kitchen_return_00424() from public, anon, authenticated;
create trigger fnb_touch_kitchen_return_00424
after update of returned_qty on public.invoice_items
for each row execute function public.fnb_touch_kitchen_return_00424();
commit;
