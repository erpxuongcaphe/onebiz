-- Forward-only: preserve stock-unit precision and complete paired POS payments.
begin;
alter table public.invoice_items alter column quantity type numeric(20,4), alter column unit_price type numeric(24,8);
alter table public.internal_sale_items alter column quantity type numeric(20,4), alter column unit_price type numeric(24,8);
alter table public.internal_sales add column pos_checkout_snapshot jsonb;

create or replace function public.checkout_internal_pos_v2(p_checkout jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_tenant uuid; v_branch uuid:=(p_checkout->>'branchId')::uuid;
 v_customer uuid:=(p_checkout->>'customerId')::uuid; v_session uuid:=(p_checkout->>'sessionId')::uuid;
 v_shift uuid:=(p_checkout->>'shiftId')::uuid; v_draft uuid:=nullif(p_checkout->>'draftId','')::uuid;
 v_revision integer:=nullif(p_checkout->>'revision','')::integer;
 v_existing record; v_product record; v_item jsonb; v_rows jsonb:='[]'; v_pay jsonb;
 v_result jsonb; v_sale uuid; v_invoice uuid; v_input uuid; v_dest uuid;
 v_qty numeric; v_price numeric; v_factor numeric; v_gross numeric; v_disc numeric; v_vat numeric;
 v_subtotal numeric:=0; v_line_disc numeric:=0; v_order_disc numeric; v_scale numeric;
 v_tax numeric:=0; v_total numeric; v_paid numeric:=0; v_amount numeric; v_method text;
 v_net numeric; v_accum numeric:=0; v_allocated numeric:=0; v_allocation numeric;
 v_order_vat numeric; v_fee numeric; v_fingerprint text; v_invoice_item record; v_index integer:=0;
begin
 select tenant_id into v_tenant from profiles where id=v_actor and is_active;
 if v_tenant is null or not user_has_permission(v_actor,'inventory.internal_export')
  or not user_has_branch_access(v_actor,v_branch) then raise exception 'INTERNAL_POS_PERMISSION_DENIED' using errcode='42501'; end if;
 if v_session is null then raise exception 'INTERNAL_POS_SESSION_REQUIRED'; end if;
 v_fingerprint:=md5(p_checkout::text);
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text||v_session::text,0));
 select s.* into v_existing from internal_sales s join invoices i on i.id=s.invoice_id
  where s.tenant_id=v_tenant and i.client_session_id=v_session;
 if found then
  if v_existing.status<>'completed' then raise exception 'INTERNAL_POS_SESSION_ALREADY_CLOSED'; end if;
  if v_existing.pos_checkout_fingerprint is distinct from v_fingerprint then raise exception 'INTERNAL_POS_SESSION_PAYLOAD_MISMATCH'; end if;
  return jsonb_build_object('internal_sale_id',v_existing.id,'code',v_existing.code,'invoice_id',v_existing.invoice_id,
   'input_invoice_id',v_existing.input_invoice_id,'total',v_existing.total);
 end if;
 select branch_id into v_dest from customers where id=v_customer and tenant_id=v_tenant and is_internal;
 if v_dest is null or v_dest=v_branch or not user_has_branch_access(v_actor,v_dest) then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;
 if not exists(select 1 from shifts where id=v_shift and tenant_id=v_tenant and branch_id=v_branch and cashier_id=v_actor and status='open') then
  raise exception 'INTERNAL_POS_OPEN_SHIFT_REQUIRED'; end if;
 if jsonb_typeof(p_checkout->'items') is distinct from 'array' or jsonb_array_length(p_checkout->'items')=0 then raise exception 'INTERNAL_POS_ITEMS_REQUIRED'; end if;
 v_order_disc:=coalesce((p_checkout->>'orderDiscount')::numeric,0);
 v_order_vat:=coalesce((p_checkout->>'orderVatRate')::numeric,0); v_fee:=coalesce((p_checkout->>'shippingFee')::numeric,0);
 if v_order_disc<0 or v_fee<0 or v_order_vat not between 0 and 100 then raise exception 'INTERNAL_POS_TOTAL_INVALID'; end if;
 for v_item in select value from jsonb_array_elements(p_checkout->'items') loop
  v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPrice')::numeric;
  v_disc:=coalesce((v_item->>'discount')::numeric,0); v_vat:=coalesce((v_item->>'vatRate')::numeric,0);
  if v_qty is null or v_qty<=0 or v_price is null or v_price<0 or v_disc<0 or v_disc>v_qty*v_price or v_vat not between 0 and 100 then raise exception 'INTERNAL_POS_ITEM_INVALID'; end if;
  if nullif(v_item->>'variantId','') is not null then raise exception 'INTERNAL_POS_VARIANT_REQUIRES_STOCK_MAPPING'; end if;
  v_subtotal:=v_subtotal+v_qty*v_price; v_line_disc:=v_line_disc+v_disc;
 end loop;
 if v_order_disc>v_subtotal-v_line_disc then raise exception 'INTERNAL_POS_DISCOUNT_INVALID'; end if;
 if v_line_disc+v_order_disc>0 then perform verify_otp_authorization(nullif(p_checkout->>'discountOtpId','')::uuid,'pos_retail.discount_override',v_actor,null); end if;
 v_scale:=case when v_subtotal-v_line_disc>0 then (v_subtotal-v_line_disc-v_order_disc)/(v_subtotal-v_line_disc) else 0 end;
 -- Lock product rows in a deterministic order before the stock chain runs.
 perform 1 from products where tenant_id=v_tenant and id in(select (x->>'productId')::uuid from jsonb_array_elements(p_checkout->'items') x) order by id for update;
 for v_item in select value from jsonb_array_elements(p_checkout->'items') loop
  select * into v_product from products where tenant_id=v_tenant and id=(v_item->>'productId')::uuid and is_active;
  if not found or v_product.inventory_role='fnb_menu_item' then raise exception 'INTERNAL_POS_PRODUCT_INVALID'; end if;
  v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPrice')::numeric;
  v_factor:=resolve_product_uom_factor(v_tenant,v_product.id,v_item->>'unit');
  if round(v_qty*v_factor,4)<=0 or round(round(v_qty*v_factor,4)*(v_price/v_factor))<>round(v_qty*v_price) then raise exception 'INTERNAL_POS_UNIT_PRECISION_INVALID'; end if;
  v_net:=v_qty*v_price-coalesce((v_item->>'discount')::numeric,0);
  v_tax:=v_tax+round(v_net*v_scale*coalesce((v_item->>'vatRate')::numeric,0)/100);
  -- Cumulative allocation preserves the exact bill discount, including the last dong.
  v_accum:=v_accum+v_net; v_allocation:=round(v_accum*v_scale)-v_allocated; v_allocated:=v_allocated+v_allocation;
  v_rows:=v_rows||jsonb_build_array(v_item||jsonb_build_object('quantity',round(v_qty*v_factor,4),
   'unitPrice',v_allocation/round(v_qty*v_factor,4),'unit',v_product.unit,'vatRate',0));
 end loop;
 v_total:=v_subtotal-v_line_disc-v_order_disc+v_tax+v_fee;
 v_tax:=v_tax+ceil(v_total*v_order_vat/100); v_total:=v_total+ceil(v_total*v_order_vat/100);
 if (p_checkout->>'expectedTotal')::numeric is distinct from v_total then raise exception 'POS_CART_TOTAL_CHANGED'; end if;
 if jsonb_typeof(p_checkout->'payments') is distinct from 'array' then raise exception 'INTERNAL_POS_PAYMENTS_REQUIRED'; end if;
 for v_pay in select value from jsonb_array_elements(p_checkout->'payments') loop
  v_amount:=(v_pay->>'amount')::numeric; v_method:=v_pay->>'method';
  if v_amount is null or v_amount<=0 or v_method is null or v_method not in ('cash','transfer','card') then raise exception 'INTERNAL_POS_PAYMENT_INVALID'; end if;
  v_paid:=v_paid+v_amount;
 end loop;
 if v_paid>v_total then raise exception 'INTERNAL_POS_PAYMENT_EXCEEDS_TOTAL'; end if;
 -- Reuse the established source/destination stock, catalog, lots and cost chain.
 v_result:=checkout_internal_pos_atomic(v_branch,v_customer,v_rows,'debt',v_allocated,v_session,v_draft,v_revision,v_shift,p_checkout->>'note');
 v_sale:=(v_result->>'internal_sale_id')::uuid; v_invoice:=(v_result->>'invoice_id')::uuid; v_input:=(v_result->>'input_invoice_id')::uuid;
 if exists(select 1 from stock_movements m join branch_stock b on b.tenant_id=m.tenant_id and b.branch_id=m.branch_id and b.product_id=m.product_id
  where m.tenant_id=v_tenant and m.branch_id=v_branch and m.reference_id=v_invoice and m.type='out' and b.quantity<0) then raise exception 'INTERNAL_POS_INSUFFICIENT_STOCK'; end if;
 v_method:=case when jsonb_array_length(p_checkout->'payments')>1 then 'mixed' else coalesce(p_checkout->'payments'->0->>'method','cash') end;
 update invoices set subtotal=v_subtotal,discount_amount=v_line_disc+v_order_disc,tax_amount=v_tax,total=v_total,paid=v_paid,debt=v_total-v_paid,
  payment_method=v_method,amount_tendered=coalesce((p_checkout->>'amountTendered')::numeric,v_paid),delivery_fee=v_fee where id=v_invoice;
 update input_invoices set total_amount=v_total,tax_amount=v_tax where id=v_input;
 update internal_sales set subtotal=v_subtotal,tax_amount=v_tax,total=v_total,pos_checkout_fingerprint=v_fingerprint,pos_checkout_snapshot=p_checkout where id=v_sale;
 -- Only the new transaction's lines are rebuilt, never historical documents.
 delete from invoice_items where invoice_id=v_invoice;
 for v_item in select value from jsonb_array_elements(p_checkout->'items') loop
  select * into v_product from products where id=(v_item->>'productId')::uuid and tenant_id=v_tenant;
  v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPrice')::numeric;
  v_factor:=resolve_product_uom_factor(v_tenant,v_product.id,v_item->>'unit');
  v_disc:=coalesce((v_item->>'discount')::numeric,0); v_vat:=coalesce((v_item->>'vatRate')::numeric,0);
  insert into invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,vat_rate,vat_amount,total)
   values(v_invoice,v_product.id,v_product.name,v_product.unit,round(v_qty*v_factor,4),v_price/v_factor,v_disc,v_vat,
    round((v_qty*v_price-v_disc)*v_scale*v_vat/100),v_qty*v_price-v_disc);
 end loop;
 -- The immutable snapshot retains entered units, prices and discounts; stock stays in base units.
 for v_pay in select value from jsonb_array_elements(p_checkout->'payments') loop
  v_amount:=(v_pay->>'amount')::numeric; v_method:=v_pay->>'method';
  insert into cash_transactions(tenant_id,branch_id,code,type,category,amount,payment_method,reference_type,reference_id,note,created_by,shift_id)
   values(v_tenant,v_branch,next_cash_code(v_tenant,'receipt'),'receipt','Ban hang noi bo',v_amount,v_method,'invoice',v_invoice,p_checkout->>'note',v_actor,v_shift);
  insert into cash_transactions(tenant_id,branch_id,code,type,category,amount,payment_method,reference_type,reference_id,note,created_by)
   values(v_tenant,v_dest,next_cash_code(v_tenant,'payment'),'payment','Mua hang noi bo',v_amount,v_method,'input_invoice',v_input,p_checkout->>'note',v_actor);
 end loop;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(v_tenant,v_actor,'pos_checkout','internal_sale',v_sale,
  jsonb_build_object('total',v_total,'paid',v_paid,'debt',v_total-v_paid,'discount',v_line_disc+v_order_disc,'paired_documents',true));
 return v_result||jsonb_build_object('total',v_total);
end; $$;
revoke all on function public.checkout_internal_pos_v2(jsonb) from public,anon;
grant execute on function public.checkout_internal_pos_v2(jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
