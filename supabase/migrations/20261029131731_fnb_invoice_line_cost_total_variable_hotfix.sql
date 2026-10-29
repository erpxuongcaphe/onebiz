set local lock_timeout='2s';
set local statement_timeout='8s';
do $guard$ begin
 if md5(pg_get_functiondef('public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)'::regprocedure)) <> '9b123bc6c7c4fa43ac3424d8c9a7e66c' then raise exception 'PAYMENT_HOTFIX_SOURCE_CHANGED'; end if;
end $guard$;
CREATE OR REPLACE FUNCTION public._snapshot_fnb_invoice_line_cost_00412(p_invoice_item_id uuid, p_events_before bigint, p_cost_before numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l record; event_count bigint; v_event_total numeric; unlinked bigint; unlinked_cost numeric;
begin
 select ii.invoice_id,ii.quantity,i.tenant_id,i.branch_id,i.source,p.inventory_role into l
 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id join public.products p on p.id=ii.product_id
 where ii.id=p_invoice_item_id;
 if not found or l.source is distinct from 'fnb' or l.quantity is null or l.quantity<=0
 or p_events_before is null or p_cost_before is null then raise exception 'FNB_00412_LINE_INVALID'; end if;
 if l.inventory_role is distinct from 'fnb_menu_item' then return; end if;
 select count(*),coalesce(sum(e.total_cost),0) into event_count,v_event_total
 from public.fnb_branch_product_cost_events e where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id
 and e.source_reference_id=l.invoice_id and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out';
 if event_count<p_events_before or v_event_total<p_cost_before then raise exception 'FNB_00412_COST_EVENT_CHANGED'; end if;
 select count(*),coalesce(sum(e.total_cost),0) into unlinked,unlinked_cost
 from public.fnb_branch_product_cost_events e where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id
 and e.source_reference_id=l.invoice_id and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out'
 and not exists(select 1 from private.fnb_cost_event_lines_20261029 m where m.event_id=e.id);
 -- Capture only the proven delta, never guess attribution from UUID ordering.
 if unlinked=event_count-p_events_before and abs(unlinked_cost-(v_event_total-p_cost_before))<=0.0001 then
  insert into private.fnb_cost_event_lines_20261029(event_id,invoice_item_id)
  select e.id,p_invoice_item_id from public.fnb_branch_product_cost_events e
  where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id and e.source_reference_id=l.invoice_id
  and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out'
  and not exists(select 1 from private.fnb_cost_event_lines_20261029 m where m.event_id=e.id)
  on conflict(event_id) do nothing;
 end if;
 if exists(select 1 from public.fnb_sale_cost_shortfalls_00473 f where f.tenant_id=l.tenant_id
 and f.branch_id=l.branch_id and f.invoice_id=l.invoice_id and f.pending_quantity>0) then
  update public.invoice_items set unit_cost=null where invoice_id=l.invoice_id;
  return;
 end if;
 update public.invoice_items set unit_cost=case when event_count>p_events_before then round((v_event_total-p_cost_before)/l.quantity,4) else null end
 where id=p_invoice_item_id;
end; $function$;
