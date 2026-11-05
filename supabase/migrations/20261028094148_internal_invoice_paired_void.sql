-- Invoice-list cancellation must use the existing paired internal-sale reversal.
-- No business rows are changed during deployment. Keep Retail/FnB code intact.
begin;
set local lock_timeout='3s';
do $patch$
declare d text; declarations text := $decl$
  v_internal_invoice record;
  v_internal_sale_id uuid;
$decl$;
dispatch text := $dispatch$
  -- internal_invoice_paired_void_20261028: do not lock the invoice before its
  -- internal_sale; the paired RPC owns sale -> invoice -> receipt lock order.
  select i.id,i.tenant_id,i.branch_id,i.source,i.status,i.code
  into v_internal_invoice
  from public.invoices i join public.profiles p
    on p.id=v_actor and p.tenant_id=i.tenant_id and p.is_active
  where i.id=p_invoice_id;
  if found and v_internal_invoice.source='internal' then
    if length(trim(coalesce(p_reason,'')))<5 then
      raise exception 'Hóa đơn nội bộ cần lý do hủy ít nhất 5 ký tự.';
    end if;
    if p_refund_method is not null and p_refund_method not in ('cash','transfer','card') then
      raise exception 'INVALID_REFUND_METHOD';
    end if;
    if p_shift_id is not null and not exists(select 1 from public.shifts s
      where s.id=p_shift_id and s.tenant_id=v_internal_invoice.tenant_id
        and s.branch_id=v_internal_invoice.branch_id and s.cashier_id=v_actor and s.status='open') then
      raise exception 'SHIFT_NOT_OPEN_FOR_USER_BRANCH';
    end if;
    select s.id into v_internal_sale_id from public.internal_sales s
      where s.invoice_id=p_invoice_id and s.tenant_id=v_internal_invoice.tenant_id for update;
    if not found then
      raise exception 'Không tìm thấy cặp chứng từ nội bộ. Cần kiểm tra liên kết trước khi hủy.';
    end if;
    -- Re-read after the sale lock: concurrent retries must not rewrite the
    -- first cancellation's refund method or insert a second invoice audit.
    select i.status into v_internal_invoice.status from public.invoices i
      where i.id=p_invoice_id and i.tenant_id=v_internal_invoice.tenant_id for update;
    -- This RPC checks active profile, internal-export + void permissions, access
    -- to BOTH branches, physical stock, cost and matched cash before any write.
    v_result:=public.cancel_internal_sale_atomic(v_internal_sale_id,trim(p_reason));
    if v_result->>'status' is distinct from 'cancelled' then
      raise exception 'INTERNAL_INVOICE_CANCEL_NOT_CONFIRMED';
    end if;
    if not exists(select 1 from public.internal_sales s
      join public.invoices i on i.id=s.invoice_id and i.tenant_id=s.tenant_id
      join public.input_invoices ii on ii.id=s.input_invoice_id and ii.tenant_id=s.tenant_id
      where s.id=v_internal_sale_id and s.tenant_id=v_internal_invoice.tenant_id
        and s.status='cancelled' and i.status='cancelled' and ii.status='cancelled') then
      raise exception 'INTERNAL_DOCUMENT_PAIR_NOT_CANCELLED';
    end if;
    if v_internal_invoice.status<>'cancelled' then
      if p_refund_method is not null then
        update public.cash_transactions set payment_method=p_refund_method
        where tenant_id=v_internal_invoice.tenant_id and reference_type='internal_sale_cancel'
          and reference_id=v_internal_sale_id and type in ('receipt','payment');
      end if;
      update public.invoices set cancelled_at=now(),cancelled_by=v_actor,
        cancel_reason=trim(p_reason),updated_at=now()
      where id=p_invoice_id and tenant_id=v_internal_invoice.tenant_id and status='cancelled';
      insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
      values(v_internal_invoice.tenant_id,v_actor,'cancel','invoice',p_invoice_id,
        jsonb_build_object('status',v_internal_invoice.status,'code',v_internal_invoice.code),
        jsonb_build_object('status','cancelled','reason',trim(p_reason),'paired',true,
          'internal_sale_id',v_internal_sale_id,'refund_method',p_refund_method,'result',v_result));
    end if;
    return v_result||jsonb_build_object('success',true,'invoice_id',p_invoice_id,
      'internal_sale_id',v_internal_sale_id,'paired',true,'fnb_kitchen_orders_cancelled',0);
  end if;
$dispatch$;
begin
  d:=replace(pg_get_functiondef('public.void_completed_invoice_atomic_v2(uuid,text,text,uuid)'::regprocedure),E'\r\n',E'\n');
  if position('internal_invoice_paired_void_20261028' in d)>0 then return;end if;
  if position('v_closed_count integer := 0;' in d)=0
    or position('  -- The private 00250 implementation' in d)=0
    or position('public._void_completed_invoice_atomic_v2_impl_00250(' in d)=0 then
    raise exception 'INTERNAL_INVOICE_VOID_WRAPPER_DRIFT';
  end if;
  d:=replace(d,'  v_closed_count integer := 0;','  v_closed_count integer := 0;'||declarations);
  d:=replace(d,'  -- The private 00250 implementation',dispatch||E'\n  -- The private 00250 implementation');
  execute d;
end $patch$;
notify pgrst,'reload schema';
commit;
