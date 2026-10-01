-- Future F&B menu sales snapshot the cost actually issued by this branch.
-- Historical invoices, Retail checkouts and stock balances are unchanged.
begin;
set local lock_timeout = '1s';

do $preflight$
begin
  if to_regprocedure('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)') is null
     or to_regclass('public.fnb_branch_product_cost_events') is null
     or to_regclass('public.fnb_invoice_item_bom_snapshots_00410') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00412_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create or replace function public._snapshot_fnb_invoice_line_cost_00412(
  p_invoice_item_id uuid,
  p_events_before bigint,
  p_cost_before numeric
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $function$
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

  -- No branch cost event is not zero cost. Keep it unknown in reports.
  update public.invoice_items
     set unit_cost = case when v_events_after > p_events_before
                          then round((v_cost_after - p_cost_before) / v_line.quantity, 4)
                          else null end
   where id = p_invoice_item_id;
end;
$function$;

revoke all on function public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)
  from public, anon, authenticated;

do $patch$
declare
  v_definition text;
  v_anchor text;
  v_count integer;
begin
  select pg_get_functiondef(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition, E'\r\n', E'\n');

  if position('_snapshot_fnb_invoice_line_cost_00412' in v_definition) > 0 then
    return;
  end if;
  if position('v_invoice_item_id uuid;' in v_definition) = 0
     or position('_capture_fnb_invoice_item_bom_snapshot_00410' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00412_PAYMENT_SHAPE_CHANGED';
  end if;

  select count(*) into v_count
    from regexp_matches(v_definition, 'returning id into v_invoice_item_id;', 'g');
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_00412_ITEM_INSERT_CHANGED';
  end if;
  v_definition := replace(
    v_definition,
    'v_invoice_item_id uuid;',
    E'v_invoice_item_id uuid;\n  v_fnb_event_count_before bigint;\n  v_fnb_cost_before numeric;'
  );
  v_definition := replace(
    v_definition,
    'returning id into v_invoice_item_id;',
    E'returning id into v_invoice_item_id;\n\n    select count(*), coalesce(sum(e.total_cost), 0)\n      into v_fnb_event_count_before, v_fnb_cost_before\n      from public.fnb_branch_product_cost_events e\n     where e.tenant_id = v_tenant_id and e.branch_id = v_branch_id\n       and e.source_reference_type = ''bom_consume''\n       and e.source_reference_id = v_invoice_id\n       and e.source_type = ''bom_consume'' and e.direction = ''out'';'
  );

  select count(*), min(parts[1]) into v_count, v_anchor
    from regexp_matches(
      v_definition,
      E'(\n[[:space:]]*end loop;[[:space:]]*\n[[:space:]]*-- 7[.] Cash transactions)',
      'g'
    ) as m(parts);
  if v_count <> 1 then
    raise exception using errcode = 'P0001', message = 'FNB_00412_PAYMENT_LOOP_CHANGED', detail = v_count::text;
  end if;
  v_definition := replace(
    v_definition,
    v_anchor,
    E'\n    perform public._snapshot_fnb_invoice_line_cost_00412(\n      v_invoice_item_id, v_fnb_event_count_before, v_fnb_cost_before\n    );' || v_anchor
  );
  execute v_definition;
end;
$patch$;

do $verify$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure
  ) into v_definition;
  if position('_capture_fnb_invoice_item_bom_snapshot_00410' in v_definition) = 0
     or position('_snapshot_fnb_invoice_line_cost_00412' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00412_INSTALL_INCOMPLETE';
  end if;
end;
$verify$;

comment on function public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric) is
  'Future F&B menu invoice lines only: snapshot the delta of this invoice''s branch BOM cost events after each line is consumed. Missing events remain unknown.';

commit;
