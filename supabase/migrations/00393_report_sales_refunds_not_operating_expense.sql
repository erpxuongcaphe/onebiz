-- Sales-return refunds reduce revenue in the reporting RPCs. They must not
-- also become operating expenses. The atomic return writer records category
-- 'Tra hang' (ASCII); older report exclusions only recognize 'Trả hàng'.
-- This migration changes function definitions only, never transaction rows.
do $$
declare
  v_name text;
  v_signature text;
  v_definition text;
  v_count integer;
begin
  for v_name, v_signature in
    select * from (values
      ('get_profit_and_loss_report', 'timestamptz,timestamptz,timestamptz,timestamptz,uuid'),
      ('get_branch_profit_and_loss_report', 'timestamptz,timestamptz'),
      ('get_finance_dashboard_report', 'timestamptz,timestamptz,timestamptz,timestamptz,uuid')
    ) as target(name, signature)
  loop
    select pg_get_functiondef(to_regprocedure('public.' || v_name || '(' || v_signature || ')'))
      into v_definition;

    if v_definition is null then
      raise exception '00393: missing public.%(%)', v_name, v_signature;
    end if;

    if v_definition like '%''Tra hang''%' then
      if v_definition not like '%''Trả hàng''%' then
        raise exception '00393: % has an unexpected refund exclusion', v_name;
      end if;
      continue;
    end if;

    if v_definition not like '%ct.type = ''payment''%'
       or v_definition not like '%coalesce(ct.category, '''') <> all(array[%' then
      raise exception '00393: % expense query differs from reviewed shape', v_name;
    end if;

    v_count := (length(v_definition) - length(replace(v_definition, '''Trả hàng''', '')))
      / length('''Trả hàng''');
    if v_count <> 1 then
      raise exception '00393: expected one refund exclusion in %, found %', v_name, v_count;
    end if;

    execute replace(v_definition, '''Trả hàng''', '''Trả hàng'', ''Tra hang''');
  end loop;
end $$;

-- Read-only verification after application:
-- select proname, pg_get_functiondef(oid) like '%''Tra hang''%' as excludes_ascii_refund
-- from pg_proc where proname in ('get_profit_and_loss_report',
--   'get_branch_profit_and_loss_report', 'get_finance_dashboard_report');
