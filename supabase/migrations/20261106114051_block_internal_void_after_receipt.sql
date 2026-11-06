-- Receiving and cancellation serialize on the same internal sale row.
do $migration$
declare
  definition text := pg_get_functiondef('public.cancel_internal_sale_atomic(uuid,text)'::regprocedure);
  anchor text := 'if length(trim(coalesce(p_reason,'''')))<5 then raise exception ''INTERNAL_SALE_CANCEL_REASON_REQUIRED''; end if;';
  old_gate text := 'if not user_has_permission(v_actor,''pos_retail.void'') then raise exception ''INTERNAL_SALE_COMPLETED_CANCEL_DENIED'' using errcode=''42501''; end if;';
  receipt_guard text := $guard$
 if v_sale.receipt_mode='legacy'
   or exists (
     select 1 from public.internal_sale_receipts r
     where r.tenant_id=v_tenant and r.internal_sale_id=v_sale.id and r.branch_id=v_sale.to_branch_id
   )
   or exists (
     select 1 from public.stock_movements m
     where m.tenant_id=v_tenant and m.branch_id=v_sale.to_branch_id
       and m.reference_id=v_sale.input_invoice_id and m.type='in'
       and m.reference_type in ('internal_sale','internal_sale_receipt_adjust')
   ) then
   raise exception 'INTERNAL_SALE_ALREADY_RECEIVED';
 end if;
 $guard$;
  target text;
begin
  target := old_gate || E'\n ' || anchor;
  definition := replace(definition,E'\r\n',E'\n');
  if length(definition)-length(replace(definition,target,'')) <> length(target) then
    raise exception 'INTERNAL_SALE_RECEIPT_VOID_SOURCE_CHANGED';
  end if;
  execute replace(definition,target,old_gate || E'\n ' || receipt_guard || anchor);
end;
$migration$;
