-- 00405: Preserve the exact sold line behind every new sales-return line.
--
-- Existing return rows remain untouched. Historical reports may resolve an old
-- row only when product name and effective line price identify one source line.

begin;

alter table public.return_items
  add column if not exists invoice_item_id uuid
    references public.invoice_items(id);

create index if not exists return_items_invoice_item_idx
  on public.return_items(invoice_item_id)
  where invoice_item_id is not null;

do $patch$
declare
  v_oid regprocedure := to_regprocedure(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'
  );
  v_definition text;
  v_old_columns text := $old_columns$
    insert into public.return_items (
      return_id, product_id, product_name, unit, quantity, unit_price, total
    ) values (
$old_columns$;
  v_new_columns text := $new_columns$
    insert into public.return_items (
      return_id, invoice_item_id, product_id, product_name, unit,
      quantity, unit_price, total
    ) values (
$new_columns$;
  v_old_values text := $old_values$
      v_return_id, v_line.product_id, v_line.product_name, v_line.unit,
      v_qty, v_unit_price, v_line_total
$old_values$;
  v_new_values text := $new_values$
      v_return_id, v_invoice_item_id, v_line.product_id, v_line.product_name,
      v_line.unit, v_qty, v_unit_price, v_line_total
$new_values$;
begin
  if v_oid is null then
    raise exception '00405: authoritative sales-return implementation is missing';
  end if;

  v_definition := pg_get_functiondef(v_oid::oid);

  if position('return_id, invoice_item_id, product_id' in v_definition) = 0 then
    if (length(v_definition) - length(replace(v_definition, v_old_columns, '')))
         / length(v_old_columns) <> 1
       or (length(v_definition) - length(replace(v_definition, v_old_values, '')))
         / length(v_old_values) <> 1 then
      raise exception '00405: sales-return implementation differs from reviewed shape';
    end if;

    v_definition := replace(v_definition, v_old_columns, v_new_columns);
    v_definition := replace(v_definition, v_old_values, v_new_values);
    execute v_definition;
  end if;
end;
$patch$;

do $verify$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public._create_sales_return_auth_impl_00244(uuid,jsonb,numeric,text,text,text,uuid)'::regprocedure
  ) into v_definition;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'return_items'
       and column_name = 'invoice_item_id'
  ) or position('return_id, invoice_item_id, product_id' in v_definition) = 0
     or position('v_return_id, v_invoice_item_id, v_line.product_id' in v_definition) = 0 then
    raise exception '00405: return source identity verification failed';
  end if;
end;
$verify$;

comment on column public.return_items.invoice_item_id is
  'Exact invoice_items row returned. NULL only for historical rows created before 00405.';

commit;

