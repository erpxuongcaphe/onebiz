-- POS entry point reuses the established atomic inter-branch sale.
begin;
alter table public.internal_sales add column pos_checkout_fingerprint text;
create or replace function public.checkout_internal_pos_atomic(
 p_from_branch_id uuid, p_customer_id uuid, p_items jsonb,
 p_payment_method text, p_expected_total numeric, p_client_session_id uuid,
 p_draft_id uuid default null, p_expected_revision integer default null,
 p_shift_id uuid default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
 v_actor uuid := auth.uid(); v_tenant uuid; v_customer record; v_supplier record;
 v_existing record; v_draft record; v_result jsonb; v_item jsonb;
 v_factor numeric; v_rows jsonb := '[]'::jsonb; v_total numeric := 0;
 v_qty numeric; v_price numeric; v_vat numeric; v_line numeric; v_product record;
 v_fingerprint text;
begin
 select tenant_id into v_tenant from public.profiles where id=v_actor and is_active;
 if v_tenant is null or not public.user_has_permission(v_actor,'inventory.internal_export')
   or not public.user_has_branch_access(v_actor,p_from_branch_id) then
   raise exception 'INTERNAL_POS_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_client_session_id is null then raise exception 'INTERNAL_POS_SESSION_REQUIRED'; end if;
 v_fingerprint:=md5(jsonb_build_object('actor',v_actor,'branch',p_from_branch_id,
  'customer',p_customer_id,'items',p_items,'payment',p_payment_method,'total',p_expected_total)::text);
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||p_client_session_id::text,0));
 select s.*,i.client_session_id into v_existing from public.internal_sales s
 join public.invoices i on i.id=s.invoice_id
 where s.tenant_id=v_tenant and i.client_session_id=p_client_session_id;
 if found then
   if v_existing.from_branch_id<>p_from_branch_id then raise exception 'INTERNAL_POS_SESSION_BRANCH_MISMATCH'; end if;
   if v_existing.pos_checkout_fingerprint is distinct from v_fingerprint then
     raise exception 'INTERNAL_POS_SESSION_PAYLOAD_MISMATCH';
   end if;
   return jsonb_build_object('internal_sale_id',v_existing.id,'code',v_existing.code,
    'invoice_id',v_existing.invoice_id,'input_invoice_id',v_existing.input_invoice_id,'total',v_existing.total);
 end if;
 select * into v_customer from public.customers where id=p_customer_id and tenant_id=v_tenant
  and is_internal and branch_id is not null;
 if not found or v_customer.branch_id=p_from_branch_id then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;
 select * into v_supplier from public.suppliers where tenant_id=v_tenant and is_internal and branch_id=p_from_branch_id;
 if not found then raise exception 'INTERNAL_POS_SUPPLIER_MISSING'; end if;
 if p_shift_id is null or not exists(select 1 from public.shifts
   where id=p_shift_id and tenant_id=v_tenant and branch_id=p_from_branch_id and cashier_id=v_actor and status='open') then
   raise exception 'INTERNAL_POS_OPEN_SHIFT_REQUIRED';
 end if;
 if p_draft_id is not null then
   select * into v_draft from public.invoices where id=p_draft_id and tenant_id=v_tenant for update;
   if not found or v_draft.status<>'draft' or v_draft.branch_id<>p_from_branch_id
    or v_draft.client_session_id is distinct from p_client_session_id
    or v_draft.draft_revision is distinct from p_expected_revision then raise exception 'POS_DRAFT_CONFLICT'; end if;
 end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'INTERNAL_POS_ITEMS_REQUIRED'; end if;
 for v_item in select value from jsonb_array_elements(p_items) loop
   select * into v_product from public.products where id=(v_item->>'productId')::uuid and tenant_id=v_tenant and is_active;
   if not found or v_product.inventory_role='fnb_menu_item' then raise exception 'INTERNAL_POS_PRODUCT_INVALID'; end if;
   if nullif(v_item->>'variantId','') is not null then raise exception 'INTERNAL_POS_VARIANT_REQUIRES_STOCK_MAPPING'; end if;
   v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPrice')::numeric;
   v_vat:=coalesce((v_item->>'vatRate')::numeric,0);
   if v_qty is null or v_qty<=0 or v_price is null or v_price<0 then raise exception 'INTERNAL_POS_ITEM_INVALID'; end if;
   v_factor:=public.resolve_product_uom_factor(v_tenant,v_product.id,v_item->>'unit');
   if round(v_qty*v_factor,4)<=0 or round(round(v_qty*v_factor,4)*(v_price/v_factor))<>round(v_qty*v_price) then
     raise exception 'INTERNAL_POS_UNIT_PRECISION_INVALID';
   end if;
   v_line:=round(v_qty*v_price); v_total:=v_total+v_line+round(v_line*v_vat/100);
   v_rows:=v_rows||jsonb_build_array(v_item||jsonb_build_object(
     'quantity',round(v_qty*v_factor,4),'unitPrice',v_price/v_factor,'unit',v_product.unit));
 end loop;
 if p_expected_total is distinct from v_total then raise exception 'POS_CART_TOTAL_CHANGED'; end if;
 -- Remove only the unposted draft, inside the same transaction. Failure restores it.
 if p_draft_id is not null then
   delete from public.invoice_items where invoice_id=p_draft_id;
   delete from public.invoices where id=p_draft_id;
 end if;
 v_result:=public.create_internal_sale_atomic(v_tenant,p_from_branch_id,v_customer.branch_id,v_actor,
  v_customer.id,v_customer.name,v_supplier.id,v_supplier.name,v_rows,p_payment_method,p_payment_method<>'debt',p_note);
 update public.internal_sales set pos_checkout_fingerprint=v_fingerprint
 where id=(v_result->>'internal_sale_id')::uuid and tenant_id=v_tenant;
 update public.invoices set client_session_id=p_client_session_id,shift_id=p_shift_id
 where id=(v_result->>'invoice_id')::uuid and tenant_id=v_tenant;
 update public.cash_transactions set shift_id=p_shift_id
 where tenant_id=v_tenant and branch_id=p_from_branch_id and reference_type='invoice'
   and reference_id=(v_result->>'invoice_id')::uuid;
 return v_result;
end; $$;
revoke all on function public.checkout_internal_pos_atomic(uuid,uuid,jsonb,text,numeric,uuid,uuid,integer,uuid,text) from public,anon;
grant execute on function public.checkout_internal_pos_atomic(uuid,uuid,jsonb,text,numeric,uuid,uuid,integer,uuid,text) to authenticated;
commit;
notify pgrst,'reload schema';
