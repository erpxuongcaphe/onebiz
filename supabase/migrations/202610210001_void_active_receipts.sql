-- Change only the receipt cursor in the existing private reversal function.
-- Keep public authorization wrappers, stock reversal and historical rows intact.
begin;
do $migration$
declare
  definition text;
  receipt_cursor text := E'    select branch_id, amount, payment_method, counterparty\n    from public.cash_transactions\n    where tenant_id = p_tenant_id\n      and reference_id = p_invoice_id\n      and reference_type = ''invoice''\n      and type = ''receipt''\n  loop';
  active_cursor text;
begin
  definition := replace(pg_get_functiondef('public._void_completed_invoice_impl_00161(uuid,uuid,uuid,text,uuid)'::regprocedure), E'\r\n', E'\n');
  active_cursor := replace(receipt_cursor, E'\n  loop', E'\n      and status = ''completed''\n  loop');
  if position(active_cursor in definition) > 0 then return; end if;
  if position(receipt_cursor in definition) = 0
    or length(definition) - length(replace(definition, receipt_cursor, '')) <> length(receipt_cursor) then
    raise exception 'VOID_RECEIPT_CURSOR_CHANGED_REVIEW_REQUIRED';
  end if;
  execute replace(definition, receipt_cursor, active_cursor);
end;
$migration$;
commit;
