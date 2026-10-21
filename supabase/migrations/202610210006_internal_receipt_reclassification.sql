-- Reclassify an already-received expense line through the actual receipt engine.
-- Receipt identity, commercial invoices, frozen classification and cash/debt are preserved.
begin;
set local lock_timeout='3s';
create table public.internal_receipt_reclassification_requests_20261021 (
 request_id uuid primary key,tenant_id uuid not null references public.tenants(id),
 receipt_id uuid not null references public.internal_sale_receipts(id),
 sale_item_id uuid not null references public.internal_sale_items(id),
 payload jsonb not null,result jsonb not null,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now()
);
alter table public.internal_receipt_reclassification_requests_20261021 enable row level security;
revoke all on public.internal_receipt_reclassification_requests_20261021 from public,anon,authenticated;
create function public.reclassify_internal_receipt_to_stock_20261021(
 p_receipt_id uuid,p_sale_item_id uuid,p_expected_revision integer,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
 v_actor uuid:=auth.uid();v_tenant uuid;v_sale public.internal_sales;v_receipt public.internal_sale_receipts;
 v_item public.internal_sale_items;v_old record;v_payload jsonb;v_policy jsonb;v_items jsonb;
 v_quantity numeric;v_expense numeric;v_zero jsonb;v_result jsonb;
begin
 select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
 if v_tenant is null or not public.user_has_permission(v_actor,'inventory.create_po')
  or not public.user_has_permission(v_actor,'inventory.adjust') or not public.user_has_permission(v_actor,'products.edit') then
  raise exception 'INTERNAL_RECLASS_DENIED' using errcode='42501';end if;
 if p_request_id is null or length(trim(coalesce(p_reason,'')))<3 then raise exception 'INTERNAL_RECLASS_REASON_REQUIRED';end if;
 select * into v_receipt from public.internal_sale_receipts where id=p_receipt_id and tenant_id=v_tenant;
 if not found then raise exception 'INTERNAL_RECLASS_NOT_FOUND' using errcode='42501';end if;
 select * into v_sale from public.internal_sales where id=v_receipt.internal_sale_id and tenant_id=v_tenant for update;
 if not found or not public.user_has_branch_access(v_actor,v_sale.to_branch_id) then raise exception 'INTERNAL_RECLASS_DENIED' using errcode='42501';end if;
 select * into v_receipt from public.internal_sale_receipts where id=p_receipt_id and tenant_id=v_tenant for update;
 v_payload:=jsonb_build_object('receipt',p_receipt_id,'item',p_sale_item_id,'revision',p_expected_revision,'reason',trim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into v_old from public.internal_receipt_reclassification_requests_20261021 where request_id=p_request_id;
 if found then
  if v_old.tenant_id<>v_tenant or v_old.payload<>v_payload then raise exception 'INTERNAL_RECLASS_REQUEST_CHANGED';end if;
  return v_old.result||jsonb_build_object('replayed',true);
 end if;
 if v_sale.status<>'completed' or v_sale.receipt_mode<>'actual' or v_sale.receiving_policy_version<>1 then raise exception 'INTERNAL_RECLASS_NOT_OPEN';end if;
 if p_expected_revision is distinct from v_receipt.revision then raise exception 'INTERNAL_RECEIVE_REVISION_CHANGED';end if;
 select * into v_item from public.internal_sale_items where id=p_sale_item_id and internal_sale_id=v_sale.id for update;
 if not found or v_item.receiving_treatment is distinct from 'expense'
  or exists(select 1 from public.internal_receiving_usage_confirmations where sale_item_id=p_sale_item_id) then raise exception 'INTERNAL_RECLASS_POLICY_CHANGED';end if;
 v_policy:=public._internal_receiving_policy_00570(v_tenant,v_sale.from_branch_id,v_sale.to_branch_id,v_item.product_id);
 if v_policy->>'treatment'<>'stock' or (v_policy->>'productId')::uuid is distinct from v_item.product_id
  or (v_policy->>'factor')::numeric is distinct from 1::numeric then raise exception 'INTERNAL_RECLASS_RECIPE_REQUIRED';end if;
 select quantity into v_quantity from public.internal_sale_receipt_items where receipt_id=p_receipt_id and sale_item_id=p_sale_item_id;
 if coalesce(v_quantity,0)<=0 or exists(select 1 from public.internal_sale_receipt_items where sale_item_id=p_sale_item_id and receipt_id<>p_receipt_id and quantity>0) then
  raise exception 'INTERNAL_RECLASS_PARTIAL_REVIEW_REQUIRED';end if;
 select sum(amount) into v_expense from public.internal_receipt_expense_sources where receipt_id=p_receipt_id and sale_item_id=p_sale_item_id and is_active;
 if v_expense is null then raise exception 'INTERNAL_RECLASS_EXPENSE_SOURCE_REQUIRED';end if;
 select jsonb_agg(jsonb_build_object('itemId',sale_item_id,'quantity',case when sale_item_id=p_sale_item_id then 0 else quantity end) order by sale_item_id)
 into v_items from public.internal_sale_receipt_items where receipt_id=p_receipt_id;
 -- Both corrections are one transaction; failure restores expense, stock and receipt revision together.
 v_zero:=public.receive_internal_sale_actual(v_sale.id,v_items,gen_random_uuid(),trim(p_reason),p_receipt_id,p_expected_revision);
 insert into public.internal_receiving_usage_confirmations(sale_item_id,tenant_id,treatment,reason,created_by)
 values(p_sale_item_id,v_tenant,'stock',trim(p_reason),v_actor);
 select jsonb_agg(jsonb_build_object('itemId',sale_item_id,'quantity',case when sale_item_id=p_sale_item_id then v_quantity else quantity end) order by sale_item_id)
 into v_items from public.internal_sale_receipt_items where receipt_id=p_receipt_id;
 v_result:=public.receive_internal_sale_actual(v_sale.id,v_items,gen_random_uuid(),trim(p_reason),p_receipt_id,(v_zero->>'revision')::integer)
  ||jsonb_build_object('saleItemId',p_sale_item_id,'quantity',v_quantity,'reversedExpense',v_expense,'treatment','stock');
 insert into public.internal_receipt_reclassification_requests_20261021(request_id,tenant_id,receipt_id,sale_item_id,payload,result,created_by)
 values(p_request_id,v_tenant,p_receipt_id,p_sale_item_id,v_payload,v_result,v_actor);
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(v_tenant,v_actor,'internal_receipt_reclassified_to_stock','internal_sale',v_sale.id,
 jsonb_build_object('receipt_id',p_receipt_id,'sale_item_id',p_sale_item_id,'treatment','expense','expense',v_expense),
 v_result||jsonb_build_object('request_id',p_request_id,'reason',trim(p_reason)));
 return v_result;
end;$fn$;
revoke all on function public.reclassify_internal_receipt_to_stock_20261021(uuid,uuid,integer,uuid,text) from public,anon;
grant execute on function public.reclassify_internal_receipt_to_stock_20261021(uuid,uuid,integer,uuid,text) to authenticated;
commit;
notify pgrst,'reload schema';
