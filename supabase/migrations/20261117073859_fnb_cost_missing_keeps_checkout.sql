begin;
set local lock_timeout = '2s';

do $patch$
declare
  definition text := replace(pg_get_functiondef(
    'public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)'::regprocedure), E'\r\n', E'\n');
  old_guard constant text := $old$raise exception using errcode = 'P0001', message = 'FNB_SALE_LINE_COST_REQUIRED',
      detail = (select p.name
                from public.invoice_items ii join public.products p on p.id = ii.product_id
                where ii.id = p_invoice_item_id);$old$;
  old_update constant text := $old$update public.invoice_items ii
  set unit_cost = r.new_unit_cost, fnb_cost_state = r.cost_state
  from private.fnb_mapped_line_cost_20261117(l.invoice_id, p_invoice_item_id) r
  where ii.id = p_invoice_item_id and r.new_unit_cost is not null;$old$;
begin
  if (length(definition) - length(replace(definition, old_guard, ''))) <> 2 * length(old_guard)
    or strpos(definition, old_update) = 0 then
    raise exception 'FNB_COST_CHECKOUT_HOTFIX_SOURCE_CHANGED';
  end if;

  -- Keep the completed sale and its event/line attribution. Missing cost is
  -- visible on the affected line so the regular receipt flow can settle it.
  definition := replace(definition, old_guard, $new$update public.invoice_items
    set unit_cost = null, fnb_cost_state = 'missing'
    where id = p_invoice_item_id;$new$);
  definition := replace(definition, old_update || E'\n  if not found then\n    ' ||
    $new$update public.invoice_items
    set unit_cost = null, fnb_cost_state = 'missing'
    where id = p_invoice_item_id;$new$ || E'\n  end if;', $new$update public.invoice_items ii
  set unit_cost = r.new_unit_cost, fnb_cost_state = coalesce(r.cost_state, 'missing')
  from (select 1) seed
  left join lateral private.fnb_mapped_line_cost_20261117(l.invoice_id, p_invoice_item_id) r on true
  where ii.id = p_invoice_item_id;$new$);
  if strpos(definition, old_update) > 0 or strpos(definition, 'FNB_SALE_LINE_COST_REQUIRED') > 0 then
    raise exception 'FNB_COST_CHECKOUT_HOTFIX_INCOMPLETE';
  end if;
  execute definition;
end $patch$;

commit;
