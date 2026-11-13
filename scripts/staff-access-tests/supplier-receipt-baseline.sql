CREATE OR REPLACE FUNCTION public.get_supplier_receipt_workspace_v1(p_branch_id uuid, p_from date, p_to date, p_page integer DEFAULT 0, p_size integer DEFAULT 50, p_supplier_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT 'all'::text, p_status text DEFAULT 'all'::text, p_search text DEFAULT NULL::text, p_sort_by text DEFAULT 'occurredAt'::text, p_sort_desc boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid();t uuid;rows jsonb;summary jsonb;total integer;fingerprint text;start_at timestamptz;end_at timestamptz;
begin
 select p.tenant_id into t from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if t is null then raise exception 'SUPPLIER_RECEIPT_DENIED' using errcode='42501';end if;
 perform public.assert_report_access('reports.analytics',p_branch_id);
 perform public.assert_report_access('reports.view_detail',p_branch_id);
 perform public.assert_report_access('suppliers.view_purchases',p_branch_id);
 if p_branch_id is null then
  if not coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false) then raise exception 'SUPPLIER_RECEIPT_ALL_BRANCHES_DENIED' using errcode='42501';end if;
 elsif not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=t)
  or not coalesce(public.user_has_branch_access(actor,p_branch_id),false) then raise exception 'SUPPLIER_RECEIPT_BRANCH_DENIED' using errcode='42501';end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) or p_to<p_from
  or p_page is null or p_page<0 or p_page>1000000 or p_size is null or p_size<1 or p_size>200
  or p_kind is null or p_kind not in ('all','receipt','revert','return')
  or p_status is null or p_status not in ('all','verified','missing_price','unlinked','invalid_quantity')
  or p_sort_desc is null or p_sort_by is null or p_sort_by not in ('occurredAt','kind','branchName','orderCode','supplierName','documentCode','documentStatus','productCode','productName','stockUnit','quantity','unitPrice','amount','signedAmount','priceSource','status') then
  raise exception 'SUPPLIER_RECEIPT_FILTER_INVALID' using errcode='22023';end if;
 start_at:=p_from::timestamp at time zone 'Asia/Ho_Chi_Minh';end_at:=(p_to+1)::timestamp at time zone 'Asia/Ho_Chi_Minh';
 if exists(select 1 from public.stock_movements sm where sm.tenant_id=t and (p_branch_id is null or sm.branch_id=p_branch_id)
  and sm.created_at>=start_at and sm.created_at<end_at and sm.reference_type in ('purchase_order','po_receive','purchase_entry','goods_receipt','purchase_order_revert','supplier_return','purchase_return')
  and not coalesce(public.user_has_branch_access(actor,sm.branch_id),false)) then raise exception 'SUPPLIER_RECEIPT_BRANCH_DENIED' using errcode='42501';end if;
 with source as materialized (
  select r from public._supplier_receipt_rows_v1(t,p_branch_id,start_at,end_at) r
  where (p_supplier_id is null or r->>'supplierId'=p_supplier_id::text)
   and (p_kind='all' or r->>'kind'=p_kind) and (p_status='all' or r->>'status'=p_status)
   and (p_search is null or btrim(p_search)='' or strpos(lower(concat_ws(' ',r->>'orderCode',r->>'documentCode',r->>'supplierName',r->>'productCode',r->>'productName')),lower(btrim(p_search)))>0)
 ), page as (
  select r,row_number() over(order by case when p_sort_desc then nullif(r->p_sort_by,'null'::jsonb) end desc nulls last,
   case when not p_sort_desc then nullif(r->p_sort_by,'null'::jsonb) end asc nulls last,r->>'id') position
  from source order by position limit p_size offset p_page::bigint*p_size
 ), totals as (
  select count(*) n,count(*) filter(where r->>'status'<>'verified') missing,
   case when count(*) filter(where r->>'kind'='receipt' and r->>'amount' is null)>0 then null else coalesce(sum((r->>'amount')::numeric) filter(where r->>'kind'='receipt'),0) end incoming,
   case when count(*) filter(where r->>'kind'='revert' and r->>'amount' is null)>0 then null else coalesce(sum((r->>'amount')::numeric) filter(where r->>'kind'='revert'),0) end reverted,
   case when count(*) filter(where r->>'kind'='return' and r->>'amount' is null)>0 then null else coalesce(sum((r->>'amount')::numeric) filter(where r->>'kind'='return'),0) end returned
  from source
 ) select (select n::integer from totals),(select coalesce(jsonb_agg(r order by position),'[]'::jsonb) from page),
  (select jsonb_build_object('rows',n,'reviewRows',missing,'receivedAmount',incoming,'revertedAmount',reverted,'returnedAmount',returned,'netAmount',incoming-reverted-returned) from totals),
  (select md5(coalesce(string_agg(md5(r::text),'' order by r->>'id'),'')) from source)
 into total,rows,summary,fingerprint;
 return jsonb_build_object('items',rows,'total',total,'summary',summary,'fingerprint',fingerprint,
  'basis','historical_goods_value_before_document_discount_tax_and_fees');
end $function$
