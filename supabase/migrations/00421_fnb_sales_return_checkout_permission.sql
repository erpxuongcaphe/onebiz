-- Permission-only patch. No business rows, grants, or Retail workflow changes.
begin;
do $patch$
declare
  definition text;
  old_guard constant text := $old$  if not public.user_has_permission(v_actor, 'pos_retail.checkout')
     and not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
    raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
  end if;$old$;
  anchor constant text := $anchor$    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0001';
  end if;$anchor$;
  new_guard constant text := $new$
  if exists (
    select 1 from public.invoices i
    where i.id = v_invoice.id and i.tenant_id = v_tenant_id and i.source = 'fnb'
  ) then
    if not public.user_has_permission(v_actor, 'pos_fnb.checkout') then
      raise exception 'FNB_RETURN_CHECKOUT_DENIED' using errcode = '42501';
    end if;
  else
    if not public.user_has_permission(v_actor, 'pos_retail.checkout')
       and not public.user_has_permission(v_actor, 'pos_fnb.view_orders') then
      raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
    end if;
  end if;$new$;
begin
  select replace(pg_get_functiondef(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ), E'\r\n', E'\n') into definition;
  if position('FNB_RETURN_CHECKOUT_DENIED' in definition) > 0 then
    if position(new_guard in definition) = 0 then
      raise exception 'FNB_00421_GUARD_SHAPE_CHANGED';
    end if;
    return;
  end if;
  if (length(definition) - length(replace(definition, old_guard, ''))) / length(old_guard) <> 1
     or (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'FNB_00421_RETURN_SHAPE_CHANGED';
  end if;
  definition := replace(definition, old_guard, '');
  definition := replace(definition, anchor, anchor || new_guard);
  execute definition;
end;
$patch$;
commit;
