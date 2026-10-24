-- Branch demand is immutable; warehouse child sales remain freely editable.
-- This migration does not backfill old documents or change stock/cash.
begin;
set local lock_timeout='2s';
-- The existing resolver returns optional record fields even when that lookup
-- was skipped (plain SKU, no tier, or direct sale). Give those records a known
-- NULL shape; leave every price lookup, precedence and free-sale rule intact.
do $warehouse_price_records$
declare definition text; marker text; initialized text;
begin
 definition:=replace(pg_get_functiondef('public.resolve_sale_price_00363(uuid,uuid,uuid,uuid,text,text,numeric,timestamptz)'::regprocedure),E'\r\n',E'\n');
 marker:=E'begin\n  if auth.uid() is null or v_tenant is null then';
 initialized:=E'begin\n  select null::uuid as id, null::numeric as sell_price into v_variant;\n  select null::uuid as id, null::numeric as price, null::uuid as variant_id, null::numeric as min_qty into v_tier_item;\n  select null::uuid as id, null::numeric as override_price, null::uuid as variant_id into v_platform_price;\n  if auth.uid() is null or v_tenant is null then';
 if position(initialized in definition)=0 then
  if position(marker in definition)=0 or position('v_variant record;' in definition)=0
   or position('v_tier_item record;' in definition)=0 or position('v_platform_price record;' in definition)=0 then
   raise exception 'WAREHOUSE_ORDER_PRICE_RESOLVER_DEFINITION_CHANGED';
  end if;
  execute replace(definition,marker,initialized);
 end if;
end $warehouse_price_records$;
create table public.fnb_purchase_sales_order_links (
 tenant_id uuid not null references public.tenants(id),
 purchase_order_id uuid primary key references public.purchase_orders(id),
 sales_order_id uuid not null unique references public.invoices(id),
 request_id uuid not null, request_payload jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(tenant_id,request_id)
);
alter table public.fnb_purchase_sales_order_links enable row level security;
revoke all on public.fnb_purchase_sales_order_links from public,anon,authenticated;
grant select on public.fnb_purchase_sales_order_links to authenticated;
create policy fnb_order_link_read on public.fnb_purchase_sales_order_links for select to authenticated using (
 tenant_id=public.get_user_tenant_id() and (
 exists(select 1 from public.purchase_orders p where p.id=purchase_order_id
 and public.user_has_branch_access(auth.uid(),p.branch_id) and public.user_has_permission(auth.uid(),'inventory.view'))
 or exists(select 1 from public.invoices i where i.id=sales_order_id
 and public.user_has_branch_access(auth.uid(),i.branch_id) and public.user_has_permission(auth.uid(),'orders.view'))));

create function public.get_fnb_warehouse_order_context(p_branch_id uuid,p_search text default '')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; warehouses jsonb; products_json jsonb;
begin
 select tenant_id into tenant from profiles where id=actor and is_active;
 if tenant is null or not user_has_permission(actor,'inventory.create_po')
 or not user_has_branch_access(actor,p_branch_id) or not exists(select 1 from branches
 where id=p_branch_id and tenant_id=tenant and is_active and branch_type='store' and cascade_mode='outlet') then
 raise exception 'Bạn không có quyền đặt kho tổng tại chi nhánh này.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'supplierId',s.id) order by b.code),'[]') into warehouses
 from branches b join suppliers s on s.branch_id=b.id and s.tenant_id=b.tenant_id and s.is_internal and s.is_active
 where b.tenant_id=tenant and b.is_active and b.branch_type='warehouse';
 select coalesce(jsonb_agg(x),'[]') into products_json from (
 select p.id,p.code,p.name,p.unit from products p where p.tenant_id=tenant and p.is_active
 and p.product_type='sku' and p.channel is distinct from 'fnb' and p.inventory_role is distinct from 'fnb_menu_item'
 -- Recipe approval does not restrict physical supplies requested from Retail.
 and length(trim(p_search))>0 and strpos(lower(p.name||' '||coalesce(p.code,'')),lower(trim(p_search)))>0
 order by p.name,p.id limit 20) x;
 return jsonb_build_object('warehouses',warehouses,'products',products_json);
end; $$;
revoke all on function public.get_fnb_warehouse_order_context(uuid,text) from public,anon;
grant execute on function public.get_fnb_warehouse_order_context(uuid,text) to authenticated;

create function public.submit_fnb_warehouse_order(p_branch_id uuid,p_warehouse_id uuid,p_request_id uuid,p_items jsonb,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; supplier record; customer record; product record;
 payload jsonb; previous record; item jsonb; rows_json jsonb:='[]'; price numeric; qty numeric;
 price_result jsonb; po jsonb; order_id uuid; order_code text; subtotal numeric:=0; n integer;
begin
 perform get_fnb_warehouse_order_context(p_branch_id,'');
 select tenant_id into tenant from profiles where id=actor and is_active;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Thiếu mã gửi hoặc danh sách hàng.'; end if;
 n:=jsonb_array_length(p_items);
 if n<1 or n>500 or length(coalesce(p_note,''))>10000 then raise exception 'Đơn cần từ 1 đến 500 mặt hàng; ghi chú tối đa 10000 ký tự.'; end if;
 if (select count(distinct value->>'productId') from jsonb_array_elements(p_items))<>n then raise exception 'Mặt hàng bị trùng.'; end if;
 -- Canonical payload excludes client-supplied prices and display names.
 select jsonb_build_object('branch',p_branch_id,'warehouse',p_warehouse_id,'note',p_note,'items',
 jsonb_agg(jsonb_build_object('productId',(value->>'productId')::uuid,'quantity',(value->>'quantity')::numeric) order by value->>'productId'))
 into payload from jsonb_array_elements(p_items);
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||p_request_id::text,0));
 select l.*,p.code as po_code,i.code as order_code,p.total from fnb_purchase_sales_order_links l
 join purchase_orders p on p.id=l.purchase_order_id join invoices i on i.id=l.sales_order_id
 where l.tenant_id=tenant and l.request_id=p_request_id into previous;
 if found then
 if previous.created_by<>actor or previous.request_payload is distinct from payload then raise exception 'Mã gửi đã dùng cho nội dung khác. Mở đơn đã gửi để kiểm tra.'; end if;
 return jsonb_build_object('purchaseOrderId',previous.purchase_order_id,'code',previous.po_code,'salesOrderId',previous.sales_order_id,'salesOrderCode',previous.order_code,'total',previous.total); end if;
 if not exists(select 1 from branches where id=p_warehouse_id and tenant_id=tenant and is_active and branch_type='warehouse') then raise exception 'Kho tổng không hợp lệ.'; end if;
 select * into supplier from suppliers where tenant_id=tenant and branch_id=p_warehouse_id and is_internal and is_active;
 if not found or (select count(*) from suppliers where tenant_id=tenant and branch_id=p_warehouse_id and is_internal and is_active)<>1 then raise exception 'Cần cấu hình duy nhất một nhà cung cấp nội bộ cho kho tổng.'; end if;
 select * into customer from customers where tenant_id=tenant and branch_id=p_branch_id and is_internal and is_active;
 if not found or (select count(*) from customers where tenant_id=tenant and branch_id=p_branch_id and is_internal and is_active)<>1 then raise exception 'Cần cấu hình duy nhất một khách nội bộ cho chi nhánh.'; end if;
 for item in select value from jsonb_array_elements(p_items) loop
 qty:=(item->>'quantity')::numeric;
 if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>100000000 or qty<>round(qty,4) then raise exception 'Số lượng không hợp lệ.'; end if;
 select * into product from products where id=(item->>'productId')::uuid and tenant_id=tenant and is_active
 and product_type='sku' and channel is distinct from 'fnb' and inventory_role is distinct from 'fnb_menu_item' for share;
 if not found then raise exception 'Mặt hàng không còn được phép đặt kho tổng.'; end if;
 price_result:=resolve_sale_price_00363(product.id,null,p_warehouse_id,customer.id,'retail','direct',qty,now());
 price:=(price_result->>'unit_price')::numeric;
 if price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or (price=0 and not coalesce(product.allow_free_sale,false)) then raise exception 'Mặt hàng chưa có giá bán nội bộ hợp lệ.'; end if;
 rows_json:=rows_json||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit',product.unit,'quantity',qty,'unit_price',price,'discount',0,'vat_rate',0));
 -- Match existing PO rounding; this remains an estimate, not a posting.
 subtotal:=subtotal+ceil(qty*price);
 end loop;
 -- Existing PO engine supplies UOM snapshots. receive_now=false: no stock/cash posting.
 po:=save_purchase_order_with_uom_atomic(null,null,p_branch_id,supplier.id,p_note,0,0,0,0,'cash',true,false,rows_json);
 order_code:=next_code(tenant,'order');
 insert into invoices(tenant_id,branch_id,code,customer_id,customer_name,status,source,subtotal,discount_amount,tax_amount,delivery_fee,total,paid,debt,payment_method,note,created_by,auto_saved)
 values(tenant,p_warehouse_id,order_code,customer.id,customer.name,'draft','order',subtotal,0,0,0,subtotal,0,subtotal,'cash',p_note,actor,false) returning id into order_id;
 insert into invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total)
 select order_id,p.id,p.name,p.unit,(x->>'quantity')::numeric,(x->>'unit_price')::numeric,0,ceil((x->>'quantity')::numeric*(x->>'unit_price')::numeric)
 from jsonb_array_elements(rows_json) x join products p on p.id=(x->>'product_id')::uuid and p.tenant_id=tenant;
 insert into fnb_purchase_sales_order_links(tenant_id,purchase_order_id,sales_order_id,request_id,request_payload,created_by)
 values(tenant,(po->>'purchase_order_id')::uuid,order_id,p_request_id,payload,actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(tenant,actor,'fnb_warehouse_order_submitted','sales_order',order_id,jsonb_build_object('purchase_order_id',po->>'purchase_order_id','branch_id',p_branch_id));
 return jsonb_build_object('purchaseOrderId',po->>'purchase_order_id','code',po->>'code','salesOrderId',order_id,'salesOrderCode',order_code,'total',subtotal);
end; $$;
revoke all on function public.submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text) to authenticated;

-- Only expose the paired order's reference/progress to the buying branch,
-- not unrestricted read access to the supplying warehouse's documents.
create function public.get_fnb_purchase_order_links(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('purchaseOrderId',p.id,'salesOrderCode',i.code,
 'processed',i.fulfilled_by_id is not null,'cancelled',i.status='cancelled')),'[]')
 from fnb_purchase_sales_order_links l join purchase_orders p on p.id=l.purchase_order_id
 join invoices i on i.id=l.sales_order_id
 where l.tenant_id=get_user_tenant_id() and p.id=any(p_ids[1:500])
 and user_has_permission(auth.uid(),'inventory.view') and user_has_branch_access(auth.uid(),p.branch_id);
$$;
revoke all on function public.get_fnb_purchase_order_links(uuid[]) from public,anon;
grant execute on function public.get_fnb_purchase_order_links(uuid[]) to authenticated;

-- A linked PO is demand only. All generic receipt/payment/edit paths roll back
-- if they attempt to post or rewrite it, including direct REST writes.
create function public.guard_fnb_linked_purchase_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare po_id uuid;
begin
 if tg_table_name='purchase_orders' then po_id:=old.id;
 elsif tg_op='DELETE' then po_id:=old.purchase_order_id;
 else po_id:=new.purchase_order_id; end if;
 if tg_table_name='purchase_order_items' and tg_op='UPDATE' then
 if exists(select 1 from fnb_purchase_sales_order_links where purchase_order_id=old.purchase_order_id) then
 raise exception 'Không sửa các dòng nhu cầu đã gửi kho tổng.'; end if;
 end if;
 if exists(select 1 from fnb_purchase_sales_order_links where purchase_order_id=po_id) then
 raise exception 'Đơn đã gửi kho tổng. Nhận hàng từ phiếu giao nội bộ; xử lý thay đổi tại đơn kho tổng.'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function public.guard_fnb_linked_purchase_order() from public,anon,authenticated;
create trigger guard_fnb_po before update or delete on public.purchase_orders for each row execute function public.guard_fnb_linked_purchase_order();
create trigger guard_fnb_po_items before insert or update or delete on public.purchase_order_items for each row execute function public.guard_fnb_linked_purchase_order();
create trigger guard_fnb_po_receipt before insert or update on public.input_invoices for each row execute function public.guard_fnb_linked_purchase_order();

create function public.guard_fnb_original_sales_order() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_table_name='invoices' then
 if exists(select 1 from fnb_purchase_sales_order_links where sales_order_id=old.id) then
 if tg_op='DELETE' then raise exception 'Giữ đơn đặt gốc để đối chiếu; hủy xử lý thay vì xóa.'; end if;
 if (to_jsonb(new)-array['status','updated_at','fulfilled_by_id'])
 is distinct from (to_jsonb(old)-array['status','updated_at','fulfilled_by_id']) then
 raise exception 'Giữ nguyên nhu cầu gốc; mở Xử lý đặt hàng để chỉnh hàng thực xuất.'; end if;
 end if;
 else
 if tg_op<>'INSERT' then
 if exists(select 1 from fnb_purchase_sales_order_links where sales_order_id=old.invoice_id) then raise exception 'Không sửa mặt hàng đơn đặt gốc.'; end if;
 end if;
 if tg_op<>'DELETE' then
 if exists(select 1 from fnb_purchase_sales_order_links where sales_order_id=new.invoice_id) then raise exception 'Không sửa mặt hàng đơn đặt gốc.'; end if;
 end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function public.guard_fnb_original_sales_order() from public,anon,authenticated;
create trigger guard_fnb_original_order before update or delete on public.invoices for each row execute function public.guard_fnb_original_sales_order();
create trigger guard_fnb_original_items before insert or update or delete on public.invoice_items for each row execute function public.guard_fnb_original_sales_order();

-- Existing checkout replaces the POS draft. Preserve its parent link across
-- that replacement, without imposing ordered SKU/quantity on actual dispatch.
alter function public.checkout_internal_pos_v2(jsonb) rename to _checkout_internal_pos_before_fnb_bridge_20261023;
revoke all on function public._checkout_internal_pos_before_fnb_bridge_20261023(jsonb) from public,anon,authenticated;
create function public.checkout_internal_pos_v2(p_checkout jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare parent uuid; result jsonb; linked record;
begin
 select i.source_order_id into parent from invoices i where i.id=nullif(p_checkout->>'draftId','')::uuid
 and i.tenant_id=get_user_tenant_id() for update;
 if parent is not null then
 select i.customer_id,i.branch_id into linked from fnb_purchase_sales_order_links l join invoices i on i.id=l.sales_order_id
 where l.sales_order_id=parent and l.tenant_id=get_user_tenant_id();
 if found and (linked.customer_id is distinct from (p_checkout->>'customerId')::uuid or linked.branch_id is distinct from (p_checkout->>'branchId')::uuid) then
 raise exception 'Đơn chi nhánh phải xuất cho đúng bên nhận; tạo đơn bán riêng nếu đổi bên nhận.'; end if;
 if not found then parent:=null; end if;
 end if;
 result:=_checkout_internal_pos_before_fnb_bridge_20261023(p_checkout);
 if parent is not null then update invoices set source_order_id=parent where id=(result->>'invoice_id')::uuid and tenant_id=get_user_tenant_id(); end if;
 return result;
end; $$;
revoke all on function public.checkout_internal_pos_v2(jsonb) from public,anon;
grant execute on function public.checkout_internal_pos_v2(jsonb) to authenticated;
commit;
