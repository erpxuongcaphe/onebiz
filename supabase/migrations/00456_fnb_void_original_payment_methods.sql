-- Preserve stock/FIFO/cost restoration and OTP guards; change only refund posting.
begin;
set local lock_timeout='3s';
do $migration$
declare oid regprocedure:=to_regprocedure('public._fnb_void_invoice_impl_00165(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'); definition text;
old_block text:=$old$  -- 4. Refund cash transaction
  if coalesce(v_invoice.paid, 0) > 0 then
    v_cash_code := public.next_code(p_tenant_id, 'cash_payment');
    if v_cash_code is null or v_cash_code = '' then
      v_cash_code := 'PC' || extract(epoch from now())::bigint::text;
    end if;

    insert into public.cash_transactions (
      tenant_id, branch_id, code, type, category, amount,
      counterparty, payment_method, reference_type, reference_id,
      note, created_by, shift_id
    ) values (
      p_tenant_id, p_branch_id, v_cash_code, 'payment', 'Hoàn trả', v_invoice.paid,
      'Khách hàng', 'cash', 'invoice', p_invoice_id,
      'Hoàn tiền HĐ ' || v_invoice.code || ': ' || coalesce(p_void_reason, ''),
      p_voided_by, coalesce(p_shift_id, v_invoice.shift_id)
    );
  end if;

$old$;
new_block text:=$new$  -- 00456: reverse actual receipt methods; never turn a transfer into cash.
  if exists(select 1 from public.sales_returns sr where sr.invoice_id=p_invoice_id and sr.tenant_id=p_tenant_id and coalesce(to_jsonb(sr)->>'status','completed') not in ('cancelled','draft')) then
    raise exception 'FNB_VOID_HAS_RETURNS: use remaining-item refund after a partial return';
  end if;
  if coalesce(v_invoice.paid,0)>0 then
    if (select coalesce(sum(c.amount),0) from public.cash_transactions c where c.tenant_id=p_tenant_id and c.branch_id=p_branch_id and c.reference_id=p_invoice_id and c.reference_type='invoice' and c.type='receipt' and coalesce(to_jsonb(c)->>'status','completed')='completed') <> v_invoice.paid then
      raise exception 'FNB_VOID_RECEIPTS_MISMATCH';
    end if;
    for v_item in
      select c.payment_method,sum(c.amount) amount from public.cash_transactions c
      where c.tenant_id=p_tenant_id and c.branch_id=p_branch_id and c.reference_id=p_invoice_id
      and c.reference_type='invoice' and c.type='receipt' and coalesce(to_jsonb(c)->>'status','completed')='completed'
      group by c.payment_method order by c.payment_method
    loop
      if v_item.payment_method not in ('cash','transfer','card') or v_item.amount<=0 then raise exception 'FNB_VOID_RECEIPT_METHOD_INVALID'; end if;
      v_cash_code:=public.next_code(p_tenant_id,'cash_payment');
      if nullif(v_cash_code,'') is null then raise exception 'CASH_CODE_REQUIRED'; end if;
      insert into public.cash_transactions(tenant_id,branch_id,code,type,category,amount,counterparty,payment_method,reference_type,reference_id,note,created_by,shift_id)
      values(p_tenant_id,p_branch_id,v_cash_code,'payment','Hoàn trả',v_item.amount,'Khách hàng',v_item.payment_method,'invoice_void',p_invoice_id,
      'Hoàn tiền '||v_invoice.code||': '||p_void_reason,p_voided_by,
      coalesce(p_shift_id,(select id from public.shifts where id=v_invoice.shift_id and tenant_id=p_tenant_id and branch_id=p_branch_id and status in ('open','pending_reconcile'))));
    end loop;
  end if;

$new$;
begin
 old_block:=replace(old_block,E'\r\n',E'\n'); new_block:=replace(new_block,E'\r\n',E'\n');
 if oid is null then raise exception 'FNB_VOID_PREREQUISITE_MISSING'; end if;
 definition:=replace(pg_get_functiondef(oid),E'\r\n',E'\n');
 if position(new_block in definition)>0 then return; end if;
 if position(old_block in definition)=0 or length(definition)-length(replace(definition,old_block,''))<>length(old_block) then raise exception 'FNB_VOID_REFUND_SOURCE_CHANGED'; end if;
 execute replace(definition,old_block,new_block);
end $migration$;
notify pgrst,'reload schema';
commit;
