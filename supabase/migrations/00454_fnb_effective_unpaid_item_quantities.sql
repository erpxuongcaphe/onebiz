-- Read the remaining unpaid quantity consistently while preserving original
-- kitchen rows. This migration does not cancel any existing item or bill.
begin;
set local lock_timeout = '3s';

do $projection$
declare v_columns text;
begin
  if not exists(select 1 from pg_attribute where attrelid='public.kitchen_order_items'::regclass
      and attname='cancelled_qty' and not attisdropped)
     or to_regprocedure('public._fnb_kitchen_remaining_00424(uuid)') is null then
    raise exception 'FNB_00454_PREREQUISITE_MISSING';
  end if;
  if exists(select 1 from public.kitchen_order_items koi join public.kitchen_orders ko on ko.id=koi.kitchen_order_id
      where ko.invoice_id is null and ko.status not in ('cancelled','completed')
        and (koi.quantity is null or koi.quantity < 0 or coalesce(koi.cancelled_qty,0) < 0
          or coalesce(koi.cancelled_qty,0) > koi.quantity)) then
    raise exception 'FNB_00454_INVALID_UNPAID_QUANTITY';
  end if;
  select string_agg(case when a.attname='quantity' then
    format('greatest(koi.quantity - coalesce(koi.cancelled_qty, 0), 0)::%s as quantity',
      format_type(a.atttypid,a.atttypmod))
    else format('koi.%I',a.attname) end, ', ' order by a.attnum)
    into v_columns from pg_attribute a
   where a.attrelid='public.kitchen_order_items'::regclass and a.attnum>0 and not a.attisdropped;
  execute 'create or replace view public._fnb_active_kitchen_items_00454 as select '
    || v_columns || ' from public.kitchen_order_items koi '
    || 'where koi.quantity - coalesce(koi.cancelled_qty,0) > 0';
end;
$projection$;
revoke all on public._fnb_active_kitchen_items_00454 from public, anon, authenticated;

do $patch$
declare
  v_config record;
  v_proc regprocedure;
  v_definition text;
  v_count integer;
  v_anchor text;
  v_replacement text;
begin
  -- Counts checked against the live definitions on 2026-10-08. Do not touch
  -- the KDS projection: it already subtracts cancellation and paid returns.
  for v_config in select * from (values
    ('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)', 'from', 2),
    ('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)', 'from', 5),
    ('public.split_kitchen_order_atomic(uuid,text,uuid[],integer)', 'from', 6),
    ('public._capture_fnb_kitchen_line_source_00423(uuid,uuid)', 'join', 1),
    ('public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)', 'from', 1)
  ) as changes(signature, keyword, expected_count) loop
    v_proc := to_regprocedure(v_config.signature);
    if v_proc is null then raise exception 'FNB_00454_FUNCTION_MISSING:%',v_config.signature; end if;
    v_definition := pg_get_functiondef(v_proc::oid);
    v_anchor := v_config.keyword || ' public.kitchen_order_items';
    v_replacement := v_config.keyword || ' public._fnb_active_kitchen_items_00454';
    v_count := (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor);
    if v_count=0 then
      if (length(v_definition)-length(replace(v_definition,v_replacement,'')))/length(v_replacement)
           <> v_config.expected_count then
        raise exception 'FNB_00454_ALREADY_PATCHED_SHAPE_CHANGED:%',v_config.signature;
      end if;
      continue;
    end if;
    if v_count<>v_config.expected_count or position(v_replacement in v_definition)>0 then
      raise exception 'FNB_00454_FUNCTION_SHAPE_CHANGED:%',v_config.signature;
    end if;
    if v_config.signature like '%impl_00230%' and (
      position('_capture_fnb_invoice_item_bom_snapshot_00410' in v_definition)=0
      or position('_snapshot_fnb_invoice_line_cost_00412' in v_definition)=0
      or position('_capture_fnb_kitchen_line_source_00423' in v_definition)=0
    ) then raise exception 'FNB_00454_PAYMENT_SNAPSHOTS_MISSING'; end if;
    execute replace(v_definition,v_anchor,v_replacement);
  end loop;
end;
$patch$;
-- A whole-bill discount follows the actual remaining value when splitting,
-- including the topping snapshots attached to the moved lines.
do $split_totals$
declare
  v_definition text := pg_get_functiondef('public.split_kitchen_order_atomic(uuid,text,uuid[],integer)'::regprocedure);
  v_anchor text := 'sum(koi.quantity * koi.unit_price)';
  v_value text := 'sum(koi.quantity * (koi.unit_price + coalesce((select sum(coalesce((topping->>''quantity'')::numeric,0) * coalesce((topping->>''price'')::numeric,0)) from jsonb_array_elements(coalesce(koi.toppings,''[]''::jsonb)) topping where coalesce((topping->>''quantity'')::numeric,0) > 0),0)))';
begin
  if position(v_value in v_definition)=0 then
    if (length(v_definition)-length(replace(v_definition,v_anchor,'')))/length(v_anchor)<>2 then
      raise exception 'FNB_00454_SPLIT_TOTAL_SHAPE_CHANGED';
    end if;
    execute replace(v_definition,v_anchor,v_value);
  elsif (length(v_definition)-length(replace(v_definition,v_value,'')))/length(v_value)<>2 then
    raise exception 'FNB_00454_SPLIT_TOTAL_PATCH_CHANGED';
  end if;
end;
$split_totals$;
comment on view public._fnb_active_kitchen_items_00454 is
  'Private projection for effective unpaid quantity. Original kitchen quantities are retained; used only by existing guarded FNB functions.';
notify pgrst, 'reload schema';
commit;
