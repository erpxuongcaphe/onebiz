-- 00407: keep F&B sales-return refunds out of operating expenses.
-- The return writer stores category 'Tra hang' while returns already reduce
-- revenue in the P&L. Update only the v2 report function definition; no rows
-- or accounting balances are changed.
begin;

do $$
declare
  v_signature constant text :=
    'timestamptz,timestamptz,timestamptz,timestamptz,uuid,boolean';
  v_definition text;
  v_count integer;
begin
  select pg_get_functiondef(
    to_regprocedure('public.get_profit_and_loss_report_v2(' || v_signature || ')')
  ) into v_definition;

  if v_definition is null then
    raise exception '00407: missing get_profit_and_loss_report_v2(%)', v_signature;
  end if;

  if v_definition like '%''Tra hang''%' then
    return;
  end if;

  if v_definition not like '%ct.type = ''payment''%'
     or v_definition not like '%coalesce(ct.category, '''') <> all(array[%'
     or v_definition not like '%''Trả hàng''%' then
    raise exception '00407: P&L v2 expense filter differs from reviewed shape';
  end if;

  v_count := (length(v_definition) - length(replace(v_definition, '''Trả hàng''', '')))
    / length('''Trả hàng''');
  if v_count <> 1 then
    raise exception '00407: expected one accented refund exclusion, found %', v_count;
  end if;

  execute replace(v_definition, '''Trả hàng''', '''Trả hàng'', ''Tra hang''');
end $$;

commit;
