CREATE OR REPLACE FUNCTION public.get_customer_report_balances_v1(p_branch_id uuid DEFAULT NULL::uuid, p_for_export boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_branches uuid[];
  v_visible boolean;
  v_balances jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_receivable numeric;
  v_advance numeric;
  v_unassigned integer;
  v_unresolved integer;
begin
  perform public.assert_report_access('reports.analytics',p_branch_id);
  if p_for_export is null then
    raise exception using errcode='22023',message='REPORT_EXPORT_MODE_INVALID';
  end if;
  if p_for_export then
    perform public.assert_report_access('reports.export',p_branch_id);
  end if;
  select tenant_id into v_tenant from public.profiles
    where id=v_actor and coalesce(is_active,true);
  if v_tenant is null then
    raise exception using errcode='42501',message='REPORT_PROFILE_INACTIVE';
  end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into v_branches
    from public.branches where tenant_id=v_tenant and (p_branch_id is null or id=p_branch_id);
  v_visible := coalesce(public.user_has_permission(v_actor,'customers.view_debt'),false);
  if v_visible then
    v_balances := public._party_directory_balances_private(v_tenant,v_branches)->'customers';
    if jsonb_typeof(v_balances) is distinct from 'array' then
      raise exception using errcode='22023',message='REPORT_BALANCE_SOURCE_INVALID';
    end if;
    if exists(select 1 from jsonb_to_recordset(v_balances) x(party_id uuid,debt numeric,advance numeric)
      where x.party_id is null or x.debt is null or x.advance is null
        or x.debt<0 or x.advance<0 or x.debt::text in ('NaN','Infinity','-Infinity')
        or x.advance::text in ('NaN','Infinity','-Infinity')
        or not exists(select 1 from public.customers c where c.tenant_id=v_tenant
          and c.id=onebiz_identity.logical_customer(v_tenant,x.party_id)
          and c.canonical_customer_id is null)) then
      raise exception using errcode='22023',message='REPORT_BALANCE_SOURCE_INVALID';
    end if;
    with amounts as (
      select onebiz_identity.logical_customer(v_tenant,x.party_id) customer_id,
        sum(x.debt) receivable,sum(x.advance) advance
      from jsonb_to_recordset(v_balances) x(party_id uuid,debt numeric,advance numeric)
      group by onebiz_identity.logical_customer(v_tenant,x.party_id)
    ), rows as (
      select a.customer_id,coalesce(c.code,'') code,c.name,a.receivable,a.advance
      from amounts a join public.customers c on c.id=a.customer_id and c.tenant_id=v_tenant
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.code,r.customer_id),'[]'::jsonb),
      coalesce(sum(r.receivable),0),coalesce(sum(r.advance),0)
      into v_rows,v_receivable,v_advance from rows r;
    select count(*)::integer into v_unresolved from (
      select id,customer_id from public.invoices where tenant_id=v_tenant and branch_id=any(v_branches)
        and status='completed' and deleted_at is null and coalesce(debt,0)>0
      union all
      select id,customer_id from public.customer_advances where tenant_id=v_tenant and branch_id=any(v_branches)
        and status='active' and remaining_amount>0
      union all
      select id,customer_id from public.debt_opening_balances where tenant_id=v_tenant and branch_id=any(v_branches)
        and party_type='customer' and amount<>0
      union all
      select a.id,a.customer_id from public.customer_debt_adjustments a
        left join public.cash_transactions ct on ct.id=a.cash_transaction_id
        where a.tenant_id=v_tenant and a.branch_id=any(v_branches) and a.amount<>0
          and coalesce(ct.category,'') not in ('customer_advance','customer_advance_refund')
          and a.idempotency_key not like 'customer-advance-allocation:%'
          and a.idempotency_key not like 'cancel-customer-advance-refund:%'
    ) source where not exists(select 1 from public.customers c where c.id=source.customer_id and c.tenant_id=v_tenant);
    if p_branch_id is null then
      select count(*)::integer into v_unassigned from (
        select id from public.invoices where tenant_id=v_tenant and branch_id is null
          and status='completed' and deleted_at is null and coalesce(debt,0)>0
        union all
        select id from public.customer_advances where tenant_id=v_tenant and branch_id is null
          and status='active' and remaining_amount>0
        union all
        select id from public.debt_opening_balances where tenant_id=v_tenant and branch_id is null
          and party_type='customer' and amount<>0
        union all
        select a.id from public.customer_debt_adjustments a
          left join public.cash_transactions ct on ct.id=a.cash_transaction_id
          where a.tenant_id=v_tenant and a.branch_id is null and a.amount<>0
            and coalesce(ct.category,'') not in ('customer_advance','customer_advance_refund')
            and a.idempotency_key not like 'customer-advance-allocation:%'
            and a.idempotency_key not like 'cancel-customer-advance-refund:%'
      ) missing_branch;
    end if;
  end if;
  return jsonb_build_object(
    'version',1,'tenant_id',v_tenant,'branch_id',p_branch_id,
    'scope',case when p_branch_id is null then 'company' else 'branch' end,
    'branch_ids',v_branches,'as_of',current_timestamp,
    'basis','current_receivable_and_customer_advance',
    'can_view_debt',v_visible,'rows',v_rows,
    'total_receivable',v_receivable,'total_advance',v_advance,
    'previous_receivable',null,
    'unassigned_balance_records',v_unassigned,
    'unresolved_balance_records',v_unresolved,
    'complete',case when v_visible then coalesce(v_unassigned,0)=0 and v_unresolved=0 else null end,
    'revision',md5(jsonb_build_array(v_tenant,p_branch_id,v_branches,v_visible,v_rows,v_unassigned,v_unresolved)::text)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.get_document_payment_history_scoped(p_reference_type text, p_reference_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_branch uuid;
  v_source text;
  v_shift uuid;
  v_allowed boolean := false;
  v_result jsonb;
begin
  if p_reference_id is null or p_reference_type is null
    or p_reference_type not in ('invoice','purchase_order')
    or p_offset is null or p_offset < 0
    or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception using errcode='22023', message='PAYMENT_HISTORY_INPUT_INVALID';
  end if;
  select p.tenant_id into v_tenant from public.profiles p
    where p.id=v_actor and p.is_active;
  if v_tenant is null then
    raise exception using errcode='42501', message='PAYMENT_HISTORY_DENIED';
  end if;

  if p_reference_type='invoice' then
    select i.branch_id,i.source,i.shift_id into v_branch,v_source,v_shift
      from public.invoices i where i.id=p_reference_id and i.tenant_id=v_tenant;
    if found then
      v_allowed := public._staff_my_cash_book_view(v_branch)
        or public._staff_permission_at_scope(v_actor,'invoices.view',v_branch)
        or (v_source='fnb' and (public._staff_permission_at_scope(v_actor,'pos_fnb.void_paid_bill',v_branch) or public._staff_legacy_paid_void_permission(v_actor,v_branch)))
        or (v_source in ('pos','internal') and public._staff_permission_at_scope(v_actor,'pos_retail.void',v_branch))
        or (
          ((v_source='fnb' and public._staff_permission_at_scope(v_actor,'pos_fnb.checkout',v_branch))
            or (v_source in ('pos','internal') and public._staff_permission_at_scope(v_actor,'pos_retail.checkout',v_branch)))
          and exists(select 1 from public.shifts s
            where s.id=v_shift and s.tenant_id=v_tenant
              and s.branch_id=v_branch and s.cashier_id=v_actor)
        );
    end if;
  else
    select po.branch_id into v_branch from public.purchase_orders po
      where po.id=p_reference_id and po.tenant_id=v_tenant;
    if found then
      v_allowed := public._staff_my_cash_book_view(v_branch)
        or public.user_has_permission(v_actor,'suppliers.view_debt');
    end if;
  end if;
  if not coalesce(v_allowed,false) or v_branch is null
    or not public.can_read_branch_document_00567(v_tenant,v_branch) then
    raise exception using errcode='42501', message='PAYMENT_HISTORY_DENIED';
  end if;

  with scoped as materialized (
    select c.id,c.code,c.type,c.amount,c.payment_method,c.note,c.created_at,
      c.occurred_at,c.transaction_date,c.time_source,c.time_reason,c.status
    from public.cash_transactions c
    where c.tenant_id=v_tenant and c.branch_id=v_branch
      and c.reference_type=p_reference_type and c.reference_id=p_reference_id
  ), page as (
    select * from scoped order by created_at desc,id desc
      offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'reference_type',p_reference_type,'reference_id',p_reference_id,
    'branch_id',v_branch,'offset',p_offset,'limit',p_limit,
    'total_count',(select count(*) from scoped),
    'rows',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_party_debt_movements(p_mode text, p_party_id uuid, p_branch_id uuid, p_from date, p_to date, p_page integer DEFAULT 0, p_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid; v_balance jsonb; v_current numeric; v_result jsonb;
begin
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 select tenant_id into v_tenant from public.profiles where id=auth.uid() and coalesce(is_active,true);
 if v_tenant is null or p_branch_id is null or not public.user_has_branch_access(auth.uid(),p_branch_id)
  or not public._staff_my_cash_book_view(p_branch_id)
  or not public.user_has_permission(auth.uid(),case p_mode when 'customer' then 'customers.view_debt' else 'suppliers.view_debt' end) then
  raise exception 'DEBT_MOVEMENT_DENIED' using errcode='42501'; end if;
 if p_mode is null or p_mode not in ('customer','supplier') or p_party_id is null or p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_from>p_to
  or p_page is null or p_page<0 or p_size is null or p_size not between 1 and 200 then raise exception 'DEBT_MOVEMENT_FILTER_INVALID' using errcode='22023'; end if;
 if not exists(select 1 from public.branches where id=p_branch_id and tenant_id=v_tenant)
  or (p_mode='customer' and not exists(select 1 from public.customers where id=p_party_id and tenant_id=v_tenant))
  or (p_mode='supplier' and not exists(select 1 from public.suppliers where id=p_party_id and tenant_id=v_tenant)) then raise exception 'DEBT_PARTY_DENIED' using errcode='42501'; end if;
 v_balance:=public.get_counterparty_balance_summary(p_branch_id);
 select coalesce((entry->>'debt')::numeric,0)-coalesce((entry->>'advance')::numeric,0) into v_current
 from jsonb_array_elements(v_balance->(case p_mode when 'customer' then 'customers' else 'suppliers' end)) entry where entry->>'party_id'=(case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,p_party_id) else p_party_id end)::text;
 v_current:=coalesce(v_current,0);
 with source as (
  select 'invoice:'||i.id as key,i.id,'invoice'::text as kind,i.code,
   (coalesce(i.issued_at,i.created_at) at time zone 'Asia/Ho_Chi_Minh')::date as date,i.created_at,i.status,
   i.total as amount,case when i.status='completed' and i.deleted_at is null then i.total else 0 end as delta,coalesce(i.note,'') as note,false as unmapped
  from public.invoices i where p_mode='customer' and i.tenant_id=v_tenant and i.branch_id=p_branch_id and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'purchase_order:'||po.id,po.id,'purchase_order',po.code,(po.created_at at time zone 'Asia/Ho_Chi_Minh')::date,po.created_at,po.status,
   po.total,case when po.status in ('completed','partial') then po.total else 0 end,coalesce(po.note,''),po.status='partial'
  from public.purchase_orders po where p_mode='supplier' and po.tenant_id=v_tenant and po.branch_id=p_branch_id and po.supplier_id=p_party_id
  union all
  select 'sales_return:'||r.id,r.id,'sales_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status in ('confirmed','completed') then -r.total else 0 end,coalesce(r.note,''),false
  from public.sales_returns r where p_mode='customer' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'supplier_return:'||r.id,r.id,'supplier_return',r.code,(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date,r.created_at,r.status,r.total,
   case when r.status='completed' then -r.total else 0 end,coalesce(r.note,''),false
  from public.supplier_returns r where p_mode='supplier' and r.tenant_id=v_tenant and r.branch_id=p_branch_id and r.supplier_id=p_party_id
  union all
  select 'opening:'||o.id,o.id,'opening','Đầu kỳ',(o.opening_date),o.created_at,'completed',abs(o.amount),o.amount,coalesce(o.note,''),false
  from public.debt_opening_balances o where o.tenant_id=v_tenant and o.branch_id=p_branch_id and o.party_type=p_mode
   and (case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,o.customer_id) else o.supplier_id end)=(case p_mode when 'customer' then onebiz_identity.logical_customer(v_tenant,p_party_id) else p_party_id end)
  union all
  select 'adjustment:'||a.id,a.id,'adjustment','Điều chỉnh',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',abs(a.amount),a.amount,a.reason,false
  from public.customer_debt_adjustments a where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and a.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
   and a.cash_transaction_id is null and coalesce(a.idempotency_key,'') not like 'sales-return-credit:%'
   and coalesce(a.idempotency_key,'') not like 'customer-advance-%' and coalesce(a.idempotency_key,'') not like 'cancel-customer-advance:%' and coalesce(a.idempotency_key,'') not like 'cancel-customer-advance-refund:%'
  union all
  select 'cash:'||c.id,c.id,'cash',c.code,c.transaction_date,c.created_at,coalesce(c.status,'completed'),c.amount,
   case when coalesce(c.status,'completed')='completed' and (c.reference_type in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance','customer_advance_refund','supplier_advance_refund'))
    then c.amount*(case when (p_mode='customer' and c.type='receipt') or (p_mode='supplier' and c.type='payment') then -1 else 1 end) else 0 end,
   coalesce(c.note,''),coalesce(c.status,'completed')='completed' and not (coalesce(c.reference_type,'') in ('invoice','invoice_void','sales_return','return','purchase_order','supplier_return') or c.category in ('customer_advance','supplier_advance','customer_advance_refund','supplier_advance_refund'))
  from public.cash_transactions c where c.tenant_id=v_tenant and c.branch_id=p_branch_id and (
   (p_mode='customer' and (c.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)) or exists(select 1 from public.invoices i where i.id=c.reference_id and c.reference_type in ('invoice','invoice_void') and i.tenant_id=v_tenant and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)))
    or exists(select 1 from public.sales_returns r where r.id=c.reference_id and c.reference_type in ('sales_return','return') and r.tenant_id=v_tenant and r.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id)))))
   or (p_mode='supplier' and (c.supplier_id=p_party_id or exists(select 1 from public.purchase_orders po where po.id=c.reference_id and c.reference_type='purchase_order' and po.tenant_id=v_tenant and po.supplier_id=p_party_id)
    or exists(select 1 from public.supplier_returns r where r.id=c.reference_id and c.reference_type='supplier_return' and r.tenant_id=v_tenant and r.supplier_id=p_party_id))))
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.customer_advance_allocations a join public.invoices i on i.id=a.invoice_id and i.tenant_id=a.tenant_id
  where p_mode='customer' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and i.customer_id=any(onebiz_identity.family_ids(v_tenant,p_party_id))
  union all
  select 'allocation:'||a.id,a.id,'allocation','Cấn ứng trước',(a.created_at at time zone 'Asia/Ho_Chi_Minh')::date,a.created_at,'completed',a.amount,0,a.note,false
  from public.supplier_advance_allocations a join public.purchase_orders po on po.id=a.purchase_order_id and po.tenant_id=a.tenant_id
  where p_mode='supplier' and a.tenant_id=v_tenant and a.branch_id=p_branch_id and po.supplier_id=p_party_id
 ), running as (
  select source.*,sum(delta) over(order by date,created_at,key rows unbounded preceding) as balance from source
 ), filtered as(select * from running where date between p_from and p_to)
 select jsonb_build_object('basis','current_effective_documents','current_net',v_current,
  'difference',v_current-coalesce((select sum(delta) from source),0),
  'unmapped',(select count(*) from source where unmapped),
  'opening',coalesce((select sum(delta) from source where date<p_from),0),
  'increase',coalesce((select sum(greatest(delta,0)) from filtered),0),
  'decrease',coalesce((select sum(greatest(-delta,0)) from filtered),0),
  'closing',coalesce((select sum(delta) from source where date<=p_to),0),
  'total',(select count(*) from filtered),
  'items',coalesce((select jsonb_agg(to_jsonb(r) order by date,created_at,key) from (select * from filtered order by date,created_at,key offset p_page::bigint*p_size limit p_size) r),'[]'::jsonb)) into v_result;
 return v_result;
end; $function$;
