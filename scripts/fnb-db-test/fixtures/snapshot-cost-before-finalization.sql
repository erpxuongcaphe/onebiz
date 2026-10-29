CREATE OR REPLACE FUNCTION public._snapshot_fnb_invoice_line_cost_00412(p_invoice_item_id uuid, p_events_before bigint, p_cost_before numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_line record;
  v_events_after bigint;
  v_cost_after numeric;
begin
  select ii.invoice_id, ii.quantity, i.tenant_id, i.branch_id, i.source,
         p.inventory_role
    into v_line
    from public.invoice_items ii
    join public.invoices i on i.id = ii.invoice_id
    join public.products p on p.id = ii.product_id
   where ii.id = p_invoice_item_id;
  if not found or v_line.source is distinct from 'fnb'
     or v_line.quantity is null or v_line.quantity <= 0
     or p_events_before is null or p_cost_before is null then
    raise exception using errcode = 'P0001', message = 'FNB_00412_LINE_INVALID';
  end if;
  if v_line.inventory_role is distinct from 'fnb_menu_item' then
    return;
  end if;
  select count(*), coalesce(sum(e.total_cost), 0)
    into v_events_after, v_cost_after
    from public.fnb_branch_product_cost_events e
   where e.tenant_id = v_line.tenant_id
     and e.branch_id = v_line.branch_id
     and e.source_reference_type = 'bom_consume'
     and e.source_reference_id = v_line.invoice_id
     and e.source_type = 'bom_consume'
     and e.direction = 'out';
  if v_events_after < p_events_before or v_cost_after < p_cost_before then
    raise exception using errcode = 'P0001', message = 'FNB_00412_COST_EVENT_CHANGED';
  end if;
    if exists(select 1 from public.fnb_sale_cost_shortfalls_00473
 where tenant_id=v_line.tenant_id and branch_id=v_line.branch_id and invoice_id=v_line.invoice_id and not cost_known) then
 update public.invoice_items set unit_cost=null where invoice_id=v_line.invoice_id;
 return;
 end if;
update public.invoice_items
     set unit_cost = case when v_events_after > p_events_before
                          then round((v_cost_after - p_cost_before) / v_line.quantity, 4)
                          else null end
   where id = p_invoice_item_id;
end;
$function$

