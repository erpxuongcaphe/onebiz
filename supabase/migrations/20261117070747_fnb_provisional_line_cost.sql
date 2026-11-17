begin;
set local lock_timeout = '2s';

alter table public.invoice_items add column fnb_cost_state text;
alter table public.invoice_items add constraint invoice_items_fnb_cost_state_check
  check (fnb_cost_state in ('final', 'estimated', 'missing')) not valid;

-- Use the exact events attached to a sale line. Replace only the estimate
-- attached to the quantity already covered by receipts or production.
create function private.fnb_mapped_line_cost_20261117(p_invoice uuid, p_line uuid default null)
returns table(id uuid, new_unit_cost numeric, cost_state text)
language sql stable set search_path = ''
as $$
  select l.id,
    case when not bool_or(coalesce(f.unknown, false)) and sum(cost.amount) >= 0
              and sum(cost.amount) / l.quantity < 100000000000
      then round(sum(cost.amount) / l.quantity, 4) end,
    case when bool_or(coalesce(f.unknown, false)) or sum(cost.amount) < 0
              or sum(cost.amount) / l.quantity >= 100000000000
      then 'missing'
      when bool_or(coalesce(f.pending, false)) then 'estimated'
      else 'final' end
  from public.invoices i
  join public.invoice_items l on l.invoice_id = i.id
  join private.fnb_cost_event_lines_20261029 m on m.invoice_item_id = l.id
  join public.fnb_branch_product_cost_events e on e.id = m.event_id
    and e.source_reference_id = i.id and e.tenant_id = i.tenant_id and e.branch_id = i.branch_id
    and e.source_type = 'bom_consume' and e.source_reference_type = 'bom_consume' and e.direction = 'out'
  left join lateral (
    select bool_or(s.pending_quantity > 0) pending,
      bool_or(s.pending_quantity > 0 and not s.cost_known) unknown,
      sum(s.settled_actual_cost - (s.quantity - s.pending_quantity) * s.estimated_unit_cost) delta
    from public.fnb_sale_cost_shortfalls_00473 s
    where s.cost_event_id = e.id and s.invoice_id = i.id
      and s.tenant_id = i.tenant_id and s.branch_id = i.branch_id
  ) f on true
  cross join lateral (select e.total_cost + coalesce(f.delta, 0) as amount) cost
  where i.id = p_invoice and i.source = 'fnb' and i.deleted_at is null
    and l.quantity > 0 and (p_line is null or l.id = p_line)
  group by l.id, l.quantity;
$$;

revoke all on function private.fnb_mapped_line_cost_20261117(uuid, uuid) from public, anon, authenticated;

do $patch$
declare
  definition text;
  anchor text;
  replacement text;
begin
  definition := replace(pg_get_functiondef(
    'public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)'::regprocedure), E'\r\n', E'\n');
  anchor := ' if exists(select 1 from public.fnb_sale_cost_shortfalls_00473 f';
  if strpos(definition, anchor) = 0 or strpos(definition, 'unlinked_cost') = 0 then
    raise exception 'FNB_COST_SNAPSHOT_CHANGED';
  end if;
  definition := left(definition, strpos(definition, anchor) - 1) || $body$
  update public.invoice_items ii
  set unit_cost = r.new_unit_cost, fnb_cost_state = coalesce(r.cost_state, 'missing')
  from (select 1) seed left join lateral private.fnb_mapped_line_cost_20261117(l.invoice_id, p_invoice_item_id) r
    on true
  where ii.id = p_invoice_item_id;
end; $function$
$body$;
  execute definition;

  definition := replace(pg_get_functiondef(
    'private.try_finalize_fnb_cost_20261029(uuid)'::regprocedure), E'\r\n', E'\n');
  anchor := ' preview:=private.preview_fnb_settled_cost_20261029(p_invoice);';
  replacement := $body$
 select jsonb_build_object(
   'complete', true, 'mode', 'event_line_mapping',
   'rows', jsonb_agg(to_jsonb(r) order by r.id)
 ) into preview from private.fnb_mapped_line_cost_20261117(p_invoice) r
 where not exists(select 1 from public.sales_returns sr where sr.invoice_id=p_invoice
                  and sr.status in ('confirmed','completed'))
 having count(*) > 0;
 if preview is null then
   preview:=private.preview_fnb_settled_cost_20261029(p_invoice);
 end if;
$body$;
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_FINALIZER_CHANGED'; end if;
  definition := replace(definition, anchor, replacement);
  anchor := 'update public.invoice_items ii set unit_cost=(r.value->>''new_unit_cost'')::numeric';
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_FINALIZER_WRITE_CHANGED'; end if;
  definition := replace(definition, anchor, anchor ||
    ', fnb_cost_state=coalesce(r.value->>''cost_state'',ii.fnb_cost_state)');
  anchor := 'and ii.unit_cost is distinct from (r.value->>''new_unit_cost'')::numeric;';
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_FINALIZER_FILTER_CHANGED'; end if;
  definition := replace(definition, anchor, $body$
 and (ii.unit_cost is distinct from (r.value->>'new_unit_cost')::numeric
      or (r.value ? 'cost_state' and ii.fnb_cost_state is distinct from (r.value->>'cost_state')));
$body$);
  anchor := '''fnb_invoice_cost_finalized'',''invoice'',p_invoice,';
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_FINALIZER_AUDIT_CHANGED'; end if;
  definition := replace(definition, anchor, $body$
  case when exists (select 1 from jsonb_array_elements(preview->'rows') r
                    where r.value->>'cost_state' in ('estimated','missing'))
       then 'fnb_invoice_cost_partially_settled'
       else 'fnb_invoice_cost_finalized' end,'invoice',p_invoice,
$body$);
  execute definition;
end $patch$;

-- Existing reporting views hide the entire invoice for legacy rows while
-- settlement is pending. A tagged F&B row already has a verified line value.
do $report$
declare
  definition text;
  anchor text;
  report_fn regprocedure := to_regprocedure(
    'public.get_profit_and_loss_report_v2(timestamptz,timestamptz,timestamptz,timestamptz,uuid,boolean)');
begin
  if to_regclass('private.report_invoice_items_final_cost_20261029') is not null then
    definition := pg_get_viewdef('private.report_invoice_items_final_cost_20261029'::regclass, true);
    anchor := 'WHEN i.source = ''fnb''::text AND';
    if strpos(definition, anchor) = 0 or strpos(definition, 'ELSE ii.unit_cost') = 0 then
      raise exception 'FNB_COST_REPORT_VIEW_CHANGED';
    end if;
    definition := replace(definition, anchor,
      'WHEN i.source = ''fnb''::text AND ii.fnb_cost_state IS NOT NULL THEN ii.unit_cost ' || anchor);
    definition := regexp_replace(definition, 'FROM (public\.)?invoice_items ii', ', ii.fnb_cost_state FROM public.invoice_items ii');
    if strpos(definition, ', ii.fnb_cost_state FROM') = 0 then raise exception 'FNB_COST_REPORT_COLUMNS_CHANGED'; end if;
    execute 'create or replace view private.report_invoice_items_final_cost_20261029 as ' || definition;
  end if;

  if report_fn is null then return; end if;
  definition := pg_get_functiondef(report_fn);
  anchor := 'count(*) filter (where ii.unit_cost is null) as missing_cost_lines';
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_REPORT_AGGREGATE_CHANGED'; end if;
  definition := replace(definition, anchor, anchor ||
    ', count(*) filter (where ii.fnb_cost_state = ''estimated'') as estimated_sales_cost_lines');
  anchor := 'coalesce(sc.missing_cost_lines, 0) as missing_sales_cost_lines,';
  if strpos(definition, anchor) = 0 then raise exception 'FNB_COST_REPORT_OUTPUT_CHANGED'; end if;
  definition := replace(definition, anchor, anchor ||
    ' coalesce(sc.estimated_sales_cost_lines, 0) as estimated_sales_cost_lines,');
  execute definition;
end $report$;

commit;
