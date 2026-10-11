-- 00474: actual receiving for NEW internal sales to F&B outlets.
-- No historical stock, lots, costs or invoices are backfilled or changed.
begin;
alter table public.internal_sales add column if not exists receipt_mode text not null default 'legacy' check (receipt_mode in ('legacy','actual'));
create table public.internal_sale_receipts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 internal_sale_id uuid not null references public.internal_sales(id), branch_id uuid not null references public.branches(id),
 request_id uuid not null, request_payload jsonb not null, note text, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(tenant_id,request_id)
);
create table public.internal_sale_receipt_items (
 receipt_id uuid not null references public.internal_sale_receipts(id), sale_item_id uuid not null references public.internal_sale_items(id),
 quantity numeric(18,4) not null check(quantity>=0), primary key(receipt_id,sale_item_id)
);
create index internal_sale_receipts_sale_idx on public.internal_sale_receipts(internal_sale_id);
alter table public.internal_sale_receipts enable row level security;
alter table public.internal_sale_receipt_items enable row level security;
create policy receipts_read_scope on public.internal_sale_receipts for select to authenticated using (
 tenant_id=public.get_user_tenant_id() and public.user_has_permission(auth.uid(),'inventory.view') and public.user_has_branch_access(auth.uid(),branch_id));
create policy receipt_items_read_scope on public.internal_sale_receipt_items for select to authenticated using (
 exists(select 1 from public.internal_sale_receipts r where r.id=receipt_id));
revoke all on public.internal_sale_receipts,public.internal_sale_receipt_items from anon,authenticated;
grant select on public.internal_sale_receipts,public.internal_sale_receipt_items to authenticated;
CREATE OR REPLACE FUNCTION public._create_internal_sale_auth_impl_00243(p_tenant_id uuid, p_from_branch_id uuid, p_to_branch_id uuid, p_created_by uuid, p_int_customer_id uuid, p_int_customer_name text, p_int_supplier_id uuid, p_int_supplier_name text, p_items jsonb, p_payment_method text DEFAULT 'transfer'::text, p_paid_full boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
 v_defer_receipt boolean;
 v_actor uuid;
 v_tenant_id uuid;
 v_is_service_role boolean :=
 coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
 v_customer record;
 v_supplier record;
 v_product record;
 v_item jsonb;
 v_product_id uuid;
 v_product_name text;
 v_product_code text;
 v_unit text;
 v_qty numeric;
 v_unit_price numeric;
 v_vat_rate numeric;
 v_line_amount numeric;
 v_line_tax numeric;
 v_subtotal numeric := 0;
 v_tax_total numeric := 0;
 v_total numeric;
 v_paid numeric;
 v_debt numeric;
 v_invoice_code text;
 v_input_inv_code text;
 v_sale_code text;
 v_invoice_id uuid;
 v_input_inv_id uuid;
 v_sale_id uuid;
 v_cash_code text;
 v_requested_payment_method text;
 v_pay_method text;
begin
 v_actor := case when v_is_service_role then p_created_by else auth.uid() end;
 if v_actor is null then
 raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
 end if;
 if not v_is_service_role
 and p_created_by is not null
 and p_created_by <> v_actor then
 raise exception 'ACTOR_SPOOF_BLOCKED' using errcode = 'P0001';
 end if;
 select p.tenant_id
 into v_tenant_id
 from public.profiles p
 where p.id = v_actor
 and coalesce(p.is_active, true);
 if not found then
 raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode = 'P0001';
 end if;
 if p_tenant_id is not null and p_tenant_id <> v_tenant_id then
 raise exception 'TENANT_SPOOF_BLOCKED' using errcode = 'P0001';
 end if;
 if not public.user_has_permission(v_actor, 'inventory.internal_export') then
 raise exception 'INSUFFICIENT_PERMISSION' using errcode = 'P0001';
 end if;
 if p_from_branch_id is null
 or p_to_branch_id is null
 or p_from_branch_id = p_to_branch_id then
 raise exception 'INVALID_BRANCH_PAIR' using errcode = 'P0001';
 end if;
 if not exists (
 select 1
 from public.branches b
 where b.id = p_from_branch_id
 and b.tenant_id = v_tenant_id
 ) or not exists (
 select 1
 from public.branches b
 where b.id = p_to_branch_id
 and b.tenant_id = v_tenant_id
 ) then
 raise exception 'BRANCH_NOT_FOUND' using errcode = 'P0001';
 end if;
 if not public.user_has_branch_access(v_actor, p_from_branch_id)
 or not public.user_has_branch_access(v_actor, p_to_branch_id) then
 raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
 end if;
 if p_items is null
 or jsonb_typeof(p_items) <> 'array'
 or jsonb_array_length(p_items) = 0 then
 raise exception 'INTERNAL_SALE_ITEMS_REQUIRED' using errcode = 'P0001';
 end if;
 v_requested_payment_method := coalesce(nullif(trim(p_payment_method), ''), 'transfer');
 if v_requested_payment_method not in ('cash', 'transfer', 'debt') then
 raise exception 'INVALID_PAYMENT_METHOD' using errcode = 'P0001';
 end if;
 select c.id, c.name
 into v_customer
 from public.customers c
 where c.tenant_id = v_tenant_id
 and c.is_internal = true
 and c.branch_id = p_to_branch_id
 limit 1;
 if not found then
 raise exception 'INTERNAL_CUSTOMER_NOT_FOUND' using errcode = 'P0001';
 end if;
 select s.id, s.name
 into v_supplier
 from public.suppliers s
 where s.tenant_id = v_tenant_id
 and s.is_internal = true
 and s.branch_id = p_from_branch_id
 limit 1;
 if not found then
 raise exception 'INTERNAL_SUPPLIER_NOT_FOUND' using errcode = 'P0001';
 end if;
 select cascade_mode = 'outlet' into v_defer_receipt from public.branches where id=p_to_branch_id and tenant_id=v_tenant_id;
 -- Validate every line and calculate totals from server-owned product rows.
 for v_item in select * from jsonb_array_elements(p_items)
 loop
 begin
 v_product_id := nullif(v_item->>'productId', '')::uuid;
 v_qty := (v_item->>'quantity')::numeric;
 v_unit_price := (v_item->>'unitPrice')::numeric;
 v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
 exception when others then
 raise exception 'INVALID_INTERNAL_SALE_ITEM' using errcode = 'P0001';
 end;
 if v_product_id is null
 or v_qty is null or v_qty <= 0
 or v_unit_price is null or v_unit_price < 0
 or v_vat_rate < 0 or v_vat_rate > 100 then
 raise exception 'INVALID_INTERNAL_SALE_ITEM' using errcode = 'P0001';
 end if;
 select p.id, p.code, p.name, p.unit, p.inventory_role
 into v_product
 from public.products p
 where p.id = v_product_id
 and p.tenant_id = v_tenant_id
 and coalesce(p.is_active, true);
 if not found then
 raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
 end if;
 if v_product.inventory_role = 'fnb_menu_item' then
 raise exception 'FNB_MENU_ITEM_NOT_TRANSFERABLE' using errcode = 'P0001';
 end if;
 v_line_amount := round(v_qty * v_unit_price);
 v_line_tax := round(v_line_amount * v_vat_rate / 100);
 v_subtotal := v_subtotal + v_line_amount;
 v_tax_total := v_tax_total + v_line_tax;
 end loop;
 v_total := v_subtotal + v_tax_total;
 v_pay_method := case
 when v_requested_payment_method = 'debt' then 'cash'
 else v_requested_payment_method
 end;
 v_paid := case
 when v_requested_payment_method = 'debt' then 0
 when coalesce(p_paid_full, false) then v_total
 else 0
 end;
 v_debt := v_total - v_paid;
 v_invoice_code := public.next_code(v_tenant_id, 'invoice');
 v_input_inv_code := public.next_code(v_tenant_id, 'input_invoice');
 v_sale_code := public.next_code(v_tenant_id, 'internal_sale');
 insert into public.invoices (
 tenant_id, branch_id, code, customer_id, customer_name,
 status, subtotal, discount_amount, tax_amount, total, paid, debt,
 payment_method, source, note, created_by
 ) values (
 v_tenant_id, p_from_branch_id, v_invoice_code,
 v_customer.id, v_customer.name,
 'completed', v_subtotal, 0, v_tax_total, v_total, v_paid, v_debt,
 v_pay_method, 'internal',
 'Ban noi bo ' || v_sale_code || ' -> ' || v_customer.name,
 v_actor
 )
 returning id into v_invoice_id;
 for v_item in select * from jsonb_array_elements(p_items)
 loop
 v_product_id := (v_item->>'productId')::uuid;
 v_qty := (v_item->>'quantity')::numeric;
 v_unit_price := (v_item->>'unitPrice')::numeric;
 v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
 select p.code, p.name, p.unit
 into v_product_code, v_product_name, v_unit
 from public.products p
 where p.id = v_product_id
 and p.tenant_id = v_tenant_id;
 v_line_amount := round(v_qty * v_unit_price);
 v_line_tax := round(v_line_amount * v_vat_rate / 100);
 insert into public.invoice_items (
 invoice_id, product_id, product_name, unit,
 quantity, unit_price, discount, vat_rate, vat_amount, total
 ) values (
 v_invoice_id, v_product_id, v_product_name, coalesce(v_unit, 'Cai'),
 v_qty, v_unit_price, 0, v_vat_rate, v_line_tax,
 v_line_amount + v_line_tax
 );
 perform public.internal_sale_apply_stock_out(
 v_tenant_id, p_from_branch_id, v_product_id, v_qty,
 v_invoice_id, v_sale_code, v_actor
 );
 end loop;
 insert into public.input_invoices (
 tenant_id, branch_id, code, supplier_id, supplier_name,
 total_amount, tax_amount, status, note, created_by
 ) values (
 v_tenant_id, p_to_branch_id, v_input_inv_code,
 v_supplier.id, v_supplier.name,
 v_total, v_tax_total, 'recorded',
 'Mua noi bo ' || v_sale_code || ' <- ' || v_supplier.name,
 v_actor
 )
 returning id into v_input_inv_id;
 for v_item in select * from jsonb_array_elements(p_items)
 loop
 v_product_id := (v_item->>'productId')::uuid;
 v_qty := (v_item->>'quantity')::numeric;
 select p.code, p.name, p.unit
 into v_product_code, v_product_name, v_unit
 from public.products p
 where p.id = v_product_id
 and p.tenant_id = v_tenant_id;
 if not coalesce(v_defer_receipt,false) then
 insert into public.stock_movements (
 tenant_id, branch_id, product_id, type, quantity,
 reference_type, reference_id, note, created_by
 ) values (
 v_tenant_id, p_to_branch_id, v_product_id, 'in', v_qty,
 'internal_sale', v_input_inv_id,
 'Nhap noi bo ' || v_sale_code || ' - ' || v_product_name,
 v_actor
 );
 perform public.increment_product_stock(v_product_id, v_qty);
 perform public.upsert_branch_stock(
 v_tenant_id, p_to_branch_id, v_product_id, v_qty
 );
 end if;
 end loop;
 if v_paid > 0 then
 v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
 insert into public.cash_transactions (
 tenant_id, branch_id, code, type, category, amount,
 payment_method, reference_type, reference_id, note, created_by
 ) values (
 v_tenant_id, p_from_branch_id, v_cash_code, 'receipt',
 'Ban hang noi bo', v_paid, v_pay_method, 'invoice', v_invoice_id,
 'Giao dich noi bo ' || v_sale_code, v_actor
 );
 v_cash_code := public.next_cash_code(v_tenant_id, 'payment');
 insert into public.cash_transactions (
 tenant_id, branch_id, code, type, category, amount,
 payment_method, reference_type, reference_id, note, created_by
 ) values (
 v_tenant_id, p_to_branch_id, v_cash_code, 'payment',
 'Mua hang noi bo', v_paid, v_pay_method,
 'input_invoice', v_input_inv_id,
 'Giao dich noi bo ' || v_sale_code, v_actor
 );
 end if;
 insert into public.internal_sales (
 tenant_id, code, from_branch_id, to_branch_id,
 invoice_id, input_invoice_id, status, receipt_mode,
 subtotal, tax_amount, total, note, created_by
 ) values (
 v_tenant_id, v_sale_code, p_from_branch_id, p_to_branch_id,
 v_invoice_id, v_input_inv_id, 'completed', case when v_defer_receipt then 'actual' else 'legacy' end,
 v_subtotal, v_tax_total, v_total, nullif(trim(p_note), ''), v_actor
 )
 returning id into v_sale_id;
 for v_item in select * from jsonb_array_elements(p_items)
 loop
 v_product_id := (v_item->>'productId')::uuid;
 v_qty := (v_item->>'quantity')::numeric;
 v_unit_price := (v_item->>'unitPrice')::numeric;
 v_vat_rate := coalesce((v_item->>'vatRate')::numeric, 0);
 v_line_amount := round(v_qty * v_unit_price);
 select p.code, p.name, p.unit
 into v_product_code, v_product_name, v_unit
 from public.products p
 where p.id = v_product_id
 and p.tenant_id = v_tenant_id;
 insert into public.internal_sale_items (
 internal_sale_id, product_id, product_code, product_name, unit,
 quantity, unit_price, vat_rate, amount, note
 ) values (
 v_sale_id, v_product_id, v_product_code, v_product_name,
 coalesce(v_unit, 'Cai'), v_qty, v_unit_price, v_vat_rate,
 v_line_amount, nullif(v_item->>'note', '')
 );
 end loop;
 insert into public.audit_log (
 tenant_id, user_id, action, entity_type, entity_id, new_data
 ) values (
 v_tenant_id,
 v_actor,
 'create',
 'internal_sale',
 v_sale_id,
 jsonb_build_object(
 'code', v_sale_code,
 'from_branch_id', p_from_branch_id,
 'to_branch_id', p_to_branch_id,
 'invoice_id', v_invoice_id,
 'input_invoice_id', v_input_inv_id,
 'total', v_total,
 'atomic', true
 )
 );
 return jsonb_build_object(
 'internal_sale_id', v_sale_id,
 'code', v_sale_code,
 'invoice_id', v_invoice_id,
 'invoice_code', v_invoice_code,
 'input_invoice_id', v_input_inv_id,
 'input_invoice_code', v_input_inv_code,
 'total', v_total
 );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_internal_sale_atomic(p_tenant_id uuid, p_from_branch_id uuid, p_to_branch_id uuid, p_created_by uuid, p_int_customer_id uuid, p_int_customer_name text, p_int_supplier_id uuid, p_int_supplier_name text, p_items jsonb, p_payment_method text DEFAULT 'transfer'::text, p_paid_full boolean DEFAULT true, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_result jsonb;
 v_sale_id uuid;
 v_tenant uuid;
 v_item record;
begin
 v_result := public._create_internal_sale_catalog_impl_00390(
 p_tenant_id, p_from_branch_id, p_to_branch_id, p_created_by,
 p_int_customer_id, p_int_customer_name, p_int_supplier_id,
 p_int_supplier_name, p_items, p_payment_method, p_paid_full, p_note
 );
 v_sale_id := (v_result->>'internal_sale_id')::uuid;
 select tenant_id into v_tenant from public.internal_sales where id = v_sale_id;
 if (select receipt_mode='legacy' from public.internal_sales where id=v_sale_id) and public._fnb_branch_cost_tracking_enabled_00390(v_tenant, p_to_branch_id) then
 for v_item in
 select isi.product_id, sum(isi.quantity) as quantity,
 round(sum(isi.amount) / nullif(sum(isi.quantity), 0), 6) as unit_price
 from public.internal_sale_items isi
 where isi.internal_sale_id = v_sale_id
 group by isi.product_id
 loop
 perform public._post_fnb_branch_cost_in_00390(
 v_tenant, p_to_branch_id, v_item.product_id, v_item.quantity, v_item.unit_price,
 'internal_sale_receipt', 'internal_sale', v_sale_id, null,
 'Nhap noi bo theo don ' || coalesce(v_result->>'code', v_sale_id::text), p_created_by
 );
 end loop;
 end if;
 return v_result;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_internal_sale_atomic(p_internal_sale_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
 v_actor uuid:=auth.uid(); v_tenant uuid; v_sale record; v_move record; v_cash record;
 v_cost record; v_balance record; v_restore_cost numeric; v_new_move uuid; v_source_paid numeric; v_dest_paid numeric; v_count integer:=0;
begin
 select tenant_id into v_tenant from profiles where id=v_actor and is_active;
 if v_tenant is null or not user_has_permission(v_actor,'inventory.internal_export') then raise exception 'INTERNAL_SALE_CANCEL_DENIED' using errcode='42501'; end if;
 select * into v_sale from internal_sales where id=p_internal_sale_id and tenant_id=v_tenant for update;
 if not found then raise exception 'INTERNAL_SALE_NOT_FOUND'; end if;
 if not user_has_branch_access(v_actor,v_sale.from_branch_id) or not user_has_branch_access(v_actor,v_sale.to_branch_id) then raise exception 'INTERNAL_SALE_BRANCH_DENIED'; end if;
 if v_sale.status<>'completed' then return _cancel_internal_sale_draft_00471(p_internal_sale_id,p_reason); end if;
 if not user_has_permission(v_actor,'pos_retail.void') then raise exception 'INTERNAL_SALE_COMPLETED_CANCEL_DENIED' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'INTERNAL_SALE_CANCEL_REASON_REQUIRED'; end if;
 perform 1 from invoices where id=v_sale.invoice_id and tenant_id=v_tenant and status='completed' for update;
 if not found then raise exception 'INTERNAL_SALE_DOCUMENT_STATE_CHANGED'; end if;
 perform 1 from input_invoices where id=v_sale.input_invoice_id and tenant_id=v_tenant and status='recorded' for update;
 if not found then raise exception 'INTERNAL_SALE_DOCUMENT_STATE_CHANGED'; end if;
 if exists(select 1 from sales_returns where invoice_id=v_sale.invoice_id and status<>'cancelled') then raise exception 'INTERNAL_SALE_ALREADY_RETURNED'; end if;
 if not exists(select 1 from stock_movements where tenant_id=v_tenant and branch_id=v_sale.from_branch_id and reference_id=v_sale.invoice_id and type='out')
 or (v_sale.receipt_mode='legacy' and not exists(select 1 from stock_movements where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id and type='in')) then
 raise exception 'INTERNAL_SALE_STOCK_PAIR_REVIEW_REQUIRED'; end if;
 perform 1 from products where id in(select product_id from stock_movements where tenant_id=v_tenant and reference_id in(v_sale.invoice_id,v_sale.input_invoice_id)) order by id for update;
 -- The destination must still physically hold every quantity being returned.
 for v_move in select product_id,sum(case when type='in' then quantity else -quantity end) quantity from stock_movements
 where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id and reference_type in ('internal_sale','internal_sale_receipt_adjust') group by product_id having sum(case when type='in' then quantity else -quantity end)>0 loop
 perform 1 from branch_stock where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and product_id=v_move.product_id and variant_id is null and quantity>=v_move.quantity for update;
 if not found then raise exception 'INTERNAL_SALE_RETURN_STOCK_INSUFFICIENT'; end if;
 end loop;
 select coalesce(sum(amount),0) into v_source_paid from cash_transactions where tenant_id=v_tenant and branch_id=v_sale.from_branch_id and reference_type='invoice' and reference_id=v_sale.invoice_id and type='receipt';
 select coalesce(sum(amount),0) into v_dest_paid from cash_transactions where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and reference_type='input_invoice' and reference_id=v_sale.input_invoice_id and type='payment';
 if v_source_paid<>v_dest_paid or v_source_paid<>(select paid from invoices where id=v_sale.invoice_id) then raise exception 'INTERNAL_SALE_PAYMENT_PAIR_REVIEW_REQUIRED'; end if;
 for v_move in
 select id,branch_id,product_id,type,quantity from stock_movements where tenant_id=v_tenant
 and branch_id=v_sale.from_branch_id and reference_id=v_sale.invoice_id and type='out'
 union all
 select null::uuid,v_sale.to_branch_id,product_id,'in'::text,
 sum(case when type='in' then quantity else -quantity end) from stock_movements where tenant_id=v_tenant
 and branch_id=v_sale.to_branch_id and reference_id=v_sale.input_invoice_id
 and reference_type in ('internal_sale','internal_sale_receipt_adjust')
 group by product_id having sum(case when type='in' then quantity else -quantity end)>0
 order by branch_id,product_id,id loop
 insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
 values(v_tenant,v_move.branch_id,v_move.product_id,case when v_move.type='out' then 'in' else 'out' end,
 v_move.quantity,'internal_sale_cancel',v_sale.id,p_reason,v_actor) returning id into v_new_move;
 if v_move.type='out' then
 select sum(total_cost)/nullif(sum(quantity),0) unit_cost into v_cost from fnb_branch_product_cost_events
 where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and direction='out'
 and (source_stock_movement_id=v_move.id or source_reference_id=v_sale.invoice_id);
 if v_cost.unit_cost is not null then perform _post_fnb_branch_cost_in_00390(v_tenant,v_move.branch_id,v_move.product_id,v_move.quantity,v_cost.unit_cost,
 'invoice_void_restore','internal_sale_cancel',v_sale.id,v_new_move,p_reason,v_actor); end if;
 elsif exists(select 1 from fnb_branch_product_cost_events where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and source_type='internal_sale_receipt' and source_reference_id=v_sale.id) then
 -- Undo the receipt's original cost, not today's weighted average.
 select sum(case when direction='in' then total_cost else -total_cost end)/nullif(sum(case when direction='in' then quantity else -quantity end),0) unit_cost into v_cost from fnb_branch_product_cost_events where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id and source_type in ('internal_sale_receipt','internal_sale_receipt_adjust') and source_reference_id=v_sale.id;
 v_restore_cost:=round(v_move.quantity*v_cost.unit_cost,4);
 select * into v_balance from fnb_branch_product_cost_balances where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id for update;
 if not found or v_balance.costed_quantity<v_move.quantity or v_balance.total_cost<v_restore_cost then raise exception 'INTERNAL_SALE_RETURN_COST_REVIEW_REQUIRED'; end if;
 update fnb_branch_product_cost_balances set costed_quantity=costed_quantity-v_move.quantity,total_cost=round(total_cost-v_restore_cost,4),
 unit_cost=case when costed_quantity-v_move.quantity<=0.0001 then 0 else round((total_cost-v_restore_cost)/(costed_quantity-v_move.quantity),6) end,
 updated_at=now(),updated_by=v_actor where tenant_id=v_tenant and branch_id=v_move.branch_id and product_id=v_move.product_id;
 insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
 values(v_tenant,v_move.branch_id,v_move.product_id,'out','invoice_void_restore','internal_sale_cancel',v_sale.id,v_new_move,v_move.quantity,v_cost.unit_cost,v_restore_cost,p_reason,v_actor);
 end if;
 perform increment_product_stock(v_move.product_id,case when v_move.type='out' then v_move.quantity else -v_move.quantity end);
 perform upsert_branch_stock(v_tenant,v_move.branch_id,v_move.product_id,case when v_move.type='out' then v_move.quantity else -v_move.quantity end);
 perform _reconcile_product_lots_to_branch_00284(v_tenant,v_move.branch_id,v_move.product_id,'internal_sale_cancel',v_sale.id,v_actor,p_reason);
 v_count:=v_count+1;
 end loop;
 if v_count=0 then raise exception 'INTERNAL_SALE_STOCK_PAIR_REVIEW_REQUIRED'; end if;
 for v_cash in select branch_id,payment_method,type,sum(amount) amount from cash_transactions where tenant_id=v_tenant and
 ((branch_id=v_sale.from_branch_id and reference_type='invoice' and reference_id=v_sale.invoice_id and type='receipt') or
 (branch_id=v_sale.to_branch_id and reference_type='input_invoice' and reference_id=v_sale.input_invoice_id and type='payment')) group by branch_id,payment_method,type loop
 insert into cash_transactions(tenant_id,branch_id,code,type,category,amount,payment_method,reference_type,reference_id,note,created_by)
 values(v_tenant,v_cash.branch_id,next_cash_code(v_tenant,case when v_cash.type='receipt' then 'payment' else 'receipt' end),
 case when v_cash.type='receipt' then 'payment' else 'receipt' end,'Hoan giao dich noi bo',v_cash.amount,v_cash.payment_method,'internal_sale_cancel',v_sale.id,p_reason,v_actor);
 end loop;
 update internal_sales set status='cancelled',note=concat_ws(E'\n',note,'[ĐÃ HỦY] '||trim(p_reason)),updated_at=now() where id=v_sale.id;
 update input_invoices set status='cancelled' where id=v_sale.input_invoice_id;
 update invoices set status='cancelled',paid=0,debt=0 where id=v_sale.invoice_id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data) values(v_tenant,v_actor,'internal_sale_cancelled','internal_sale',v_sale.id,
 jsonb_build_object('status','completed'),jsonb_build_object('status','cancelled','reason',p_reason,'paired',true,'stock_movements',v_count,'refunded',v_source_paid));
 return jsonb_build_object('id',v_sale.id,'status','cancelled','stock_changed',true,'reversed_stock_movements',v_count,'reversed_cash',v_source_paid);
end; $function$
;
create table public.internal_sale_receipt_requests (
 request_id uuid primary key, tenant_id uuid not null, receipt_id uuid not null references public.internal_sale_receipts(id),
 payload jsonb not null, created_at timestamptz not null default now()
);
alter table public.internal_sale_receipts add column revision integer not null default 0;
alter table public.internal_sale_receipt_requests enable row level security;
revoke all on public.internal_sale_receipt_requests from public,anon,authenticated;

-- Absolute quantities on a receipt; later edits post ONLY the delta, with optimistic revision.
create or replace function public.receive_internal_sale_actual(
 p_sale_id uuid, p_items jsonb, p_request_id uuid, p_note text default null,
 p_receipt_id uuid default null, p_expected_revision integer default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_actor uuid:=auth.uid(); v_tenant uuid; v_sale record; v_receipt record; v_line record; v_cost record;
 v_item jsonb; v_payload jsonb; v_previous jsonb; v_receipt_id uuid; v_revision integer;
 v_qty numeric; v_old numeric; v_other numeric; v_delta numeric; v_cost_delta numeric; v_move uuid;
 v_has_change boolean:=false;
begin
 select tenant_id into v_tenant from profiles where id=v_actor and is_active;
 if v_tenant is null or not user_has_permission(v_actor,'inventory.create_po') then
  raise exception 'INTERNAL_RECEIVE_DENIED' using errcode='42501'; end if;
 select * into v_sale from internal_sales where id=p_sale_id and tenant_id=v_tenant for update;
 if not found or not user_has_branch_access(v_actor,v_sale.to_branch_id) then
  raise exception 'INTERNAL_RECEIVE_BRANCH_DENIED' using errcode='42501'; end if;
 if v_sale.status<>'completed' or v_sale.receipt_mode<>'actual' then raise exception 'INTERNAL_RECEIVE_ORDER_NOT_OPEN'; end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then
  raise exception 'INTERNAL_RECEIVE_ITEMS_REQUIRED'; end if;
 if jsonb_array_length(p_items)<> (select count(distinct value->>'itemId') from jsonb_array_elements(p_items)) then
  raise exception 'INTERNAL_RECEIVE_DUPLICATE_ITEM'; end if;
 select jsonb_agg(value order by value->>'itemId') into v_payload from jsonb_array_elements(p_items);
 v_payload:=jsonb_build_object('sale',p_sale_id,'items',v_payload,'receipt',p_receipt_id,'revision',p_expected_revision,'note',nullif(trim(p_note),''));
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into v_receipt from internal_sale_receipt_requests where request_id=p_request_id;
 if found then
  if v_receipt.tenant_id<>v_tenant or v_receipt.payload<>v_payload then raise exception 'INTERNAL_RECEIVE_REQUEST_CHANGED'; end if;
  return jsonb_build_object('receiptId',v_receipt.receipt_id,'replayed',true);
 end if;
 if p_receipt_id is null then
  insert into internal_sale_receipts(tenant_id,internal_sale_id,branch_id,request_id,request_payload,note,created_by)
  values(v_tenant,p_sale_id,v_sale.to_branch_id,p_request_id,v_payload,nullif(trim(p_note),''),v_actor) returning id into v_receipt_id;
  v_revision:=0; v_previous:='[]'::jsonb;
 else
  if not user_has_permission(v_actor,'inventory.adjust') then raise exception 'INTERNAL_RECEIVE_ADJUST_DENIED' using errcode='42501'; end if;
  if length(trim(coalesce(p_note,'')))<3 then raise exception 'INTERNAL_RECEIVE_ADJUST_REASON_REQUIRED'; end if;
  select * into v_receipt from internal_sale_receipts where id=p_receipt_id and tenant_id=v_tenant and internal_sale_id=p_sale_id for update;
  if not found then raise exception 'INTERNAL_RECEIVE_RECEIPT_NOT_FOUND'; end if;
  if p_expected_revision is distinct from v_receipt.revision then raise exception 'INTERNAL_RECEIVE_REVISION_CHANGED'; end if;
  v_receipt_id:=p_receipt_id; v_revision:=v_receipt.revision;
  select coalesce(jsonb_agg(jsonb_build_object('itemId',sale_item_id,'quantity',quantity)),'[]'::jsonb) into v_previous
  from internal_sale_receipt_items where receipt_id=v_receipt_id;
  if exists(select 1 from internal_sale_receipt_items ri where ri.receipt_id=v_receipt_id and not exists(
   select 1 from jsonb_array_elements(p_items) x where (x->>'itemId')::uuid=ri.sale_item_id)) then raise exception 'INTERNAL_RECEIVE_ADJUST_ITEMS_REQUIRED'; end if;
 end if;
 -- Deterministic locking across products. Sale lock serializes all its receipts.
 perform 1 from products where id in(select product_id from internal_sale_items where internal_sale_id=p_sale_id) order by id for update;
 for v_item in select value from jsonb_array_elements(p_items) order by value->>'itemId' loop
  v_qty:=(v_item->>'quantity')::numeric;
  if v_qty is null or v_qty<0 or v_qty<>round(v_qty,4) or v_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'INTERNAL_RECEIVE_QUANTITY_INVALID'; end if;
  select * into v_line from internal_sale_items where id=(v_item->>'itemId')::uuid and internal_sale_id=p_sale_id;
  if not found then raise exception 'INTERNAL_RECEIVE_ITEM_NOT_FOUND'; end if;
  select coalesce(quantity,0) into v_old from internal_sale_receipt_items where receipt_id=v_receipt_id and sale_item_id=v_line.id;
  v_old:=coalesce(v_old,0);
  select coalesce(sum(ri.quantity),0) into v_other from internal_sale_receipt_items ri join internal_sale_receipts r on r.id=ri.receipt_id
  where r.internal_sale_id=p_sale_id and ri.sale_item_id=v_line.id and r.id<>v_receipt_id;
  if v_other+v_qty>v_line.quantity then raise exception 'INTERNAL_RECEIVE_EXCEEDS_DISPATCHED'; end if;
  v_delta:=v_qty-v_old;
  if v_delta<>0 then
   v_has_change:=true;
   if v_delta<0 then
    perform 1 from branch_stock where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and product_id=v_line.product_id
     and variant_id is null and quantity>=-v_delta for update;
    if not found then raise exception 'INTERNAL_RECEIVE_ADJUST_STOCK_INSUFFICIENT'; end if;
   end if;
   insert into stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
   values(v_tenant,v_sale.to_branch_id,v_line.product_id,case when v_delta>0 then 'in' else 'out' end,abs(v_delta),
    case when v_delta>0 then 'internal_sale' else 'internal_sale_receipt_adjust' end,v_sale.input_invoice_id,
    'Thực nhận '||v_sale.code||' · '||coalesce(p_note,''),v_actor) returning id into v_move;
   perform increment_product_stock(v_line.product_id,v_delta);
   perform upsert_branch_stock(v_tenant,v_sale.to_branch_id,v_line.product_id,v_delta);
   if _fnb_branch_cost_tracking_enabled_00390(v_tenant,v_sale.to_branch_id) then
    if v_delta>0 then
     perform _post_fnb_branch_cost_in_00390(v_tenant,v_sale.to_branch_id,v_line.product_id,v_delta,v_line.unit_price,
      'internal_sale_receipt','internal_sale',v_sale.id,v_move,p_note,v_actor);
    else
     select * into v_cost from fnb_branch_product_cost_balances where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and product_id=v_line.product_id for update;
     v_cost_delta:=round(-v_delta*v_line.unit_price,4);
     if not found or v_cost.costed_quantity<-v_delta or v_cost.total_cost<v_cost_delta then raise exception 'INTERNAL_RECEIVE_ADJUST_COST_REVIEW_REQUIRED'; end if;
     update fnb_branch_product_cost_balances set costed_quantity=costed_quantity+v_delta,total_cost=round(total_cost-v_cost_delta,4),
      unit_cost=case when costed_quantity+v_delta<=0.0001 then 0 else round((total_cost-v_cost_delta)/(costed_quantity+v_delta),6) end,
      updated_at=now(),updated_by=v_actor where tenant_id=v_tenant and branch_id=v_sale.to_branch_id and product_id=v_line.product_id;
     insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
     values(v_tenant,v_sale.to_branch_id,v_line.product_id,'out','internal_sale_receipt','internal_sale_receipt_adjust',v_sale.id,v_move,-v_delta,v_line.unit_price,v_cost_delta,p_note,v_actor);
    end if;
   end if;
   perform _reconcile_product_lots_to_branch_00284(v_tenant,v_sale.to_branch_id,v_line.product_id,'internal_sale',v_sale.id,v_actor,p_note);
  end if;
  insert into internal_sale_receipt_items(receipt_id,sale_item_id,quantity) values(v_receipt_id,v_line.id,v_qty)
   on conflict(receipt_id,sale_item_id) do update set quantity=excluded.quantity;
 end loop;
 if not v_has_change then raise exception 'INTERNAL_RECEIVE_NO_CHANGE'; end if;
 update internal_sale_receipts set revision=v_revision+1,updated_at=now(),note=coalesce(nullif(trim(p_note),''),note) where id=v_receipt_id;
 insert into internal_sale_receipt_requests(request_id,tenant_id,receipt_id,payload) values(p_request_id,v_tenant,v_receipt_id,v_payload);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(v_tenant,v_actor,case when p_receipt_id is null then 'internal_sale_received' else 'internal_sale_receipt_adjusted' end,'internal_sale',p_sale_id,
  jsonb_build_object('items',v_previous),jsonb_build_object('receipt_id',v_receipt_id,'branch_id',v_sale.to_branch_id,'items',p_items,'note',p_note,'revision',v_revision+1));
 return jsonb_build_object('receiptId',v_receipt_id,'revision',v_revision+1,'replayed',false);
end; $$;
revoke all on function public.receive_internal_sale_actual(uuid,jsonb,uuid,text,uuid,integer) from public,anon;
grant execute on function public.receive_internal_sale_actual(uuid,jsonb,uuid,text,uuid,integer) to authenticated;

create or replace function public.get_internal_receiving_workspace(p_branch_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_result jsonb;
begin
 select tenant_id into v_tenant from profiles where id=v_actor and is_active;
 if v_tenant is null or not user_has_permission(v_actor,'inventory.view') or not user_has_branch_access(v_actor,p_branch_id) then
  raise exception 'INTERNAL_RECEIVE_BRANCH_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'code',s.code,'createdAt',s.created_at,'fromBranch',b.name,
  'invoiceId',s.invoice_id,'items',(select jsonb_agg(jsonb_build_object('id',i.id,'productId',i.product_id,'code',i.product_code,
   'name',i.product_name,'unit',i.unit,'dispatched',i.quantity,'received',coalesce(q.quantity,0)) order by i.product_code,i.id)
   from internal_sale_items i left join lateral (select sum(ri.quantity) quantity from internal_sale_receipt_items ri
    join internal_sale_receipts r on r.id=ri.receipt_id where r.internal_sale_id=s.id and ri.sale_item_id=i.id) q on true where i.internal_sale_id=s.id),
  'receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'createdAt',r.created_at,'updatedAt',r.updated_at,'revision',r.revision,'note',r.note,
   'createdBy',p.full_name,'items',(select jsonb_agg(jsonb_build_object('itemId',ri.sale_item_id,'quantity',ri.quantity)) from internal_sale_receipt_items ri where ri.receipt_id=r.id)) order by r.created_at),'[]'::jsonb)
   from internal_sale_receipts r left join profiles p on p.id=r.created_by where r.internal_sale_id=s.id)) order by s.created_at desc),'[]'::jsonb) into v_result
 from (select * from internal_sales where tenant_id=v_tenant and to_branch_id=p_branch_id and status='completed' and receipt_mode='actual' order by created_at desc) s
 join branches b on b.id=s.from_branch_id and b.tenant_id=v_tenant;
 return v_result;
end; $$;
revoke all on function public.get_internal_receiving_workspace(uuid) from public,anon;
grant execute on function public.get_internal_receiving_workspace(uuid) to authenticated;
commit;
notify pgrst,'reload schema';
