-- Canonical quantities remain the stock/report contract; optional transaction snapshots retain entry units.

begin; set local lock_timeout='5s';

-- BEGIN production drift guard
do $guard$ begin
if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='change_fnb_warehouse_order') is distinct from 'bb9495b2c32d34c8617ca4993356587b' then raise exception 'UOM_BASE_DEFINITION_CHANGED: change_fnb_warehouse_order'; end if;
if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='get_fnb_warehouse_order_for_change') is distinct from 'fb8a8d89d80d72334ffb3356f9c9d236' then raise exception 'UOM_BASE_DEFINITION_CHANGED: get_fnb_warehouse_order_for_change'; end if;
if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='save_sales_order_atomic') is distinct from 'e5d7b40fb213765826dd761b3e03233d' then raise exception 'UOM_BASE_DEFINITION_CHANGED: save_sales_order_atomic'; end if;
if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_fnb_warehouse_order') is distinct from 'b4f8ddfff6382cbc39ee1e333eebfb6f' then raise exception 'UOM_BASE_DEFINITION_CHANGED: submit_fnb_warehouse_order'; end if;
if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_create_internal_sale_auth_impl_00243') is distinct from 'e14ed33f242e4ae30531d7eb7ceb5b16' then raise exception 'UOM_BASE_DEFINITION_CHANGED: _create_internal_sale_auth_impl_00243'; end if;
end $guard$;
-- END production drift guard

alter table public.invoice_items
 add column if not exists transaction_quantity numeric,
 add column if not exists transaction_unit text,
 add column if not exists transaction_unit_price numeric,
 add column if not exists conversion_factor numeric;

alter table public.internal_sale_items
 add column if not exists transaction_quantity numeric,
 add column if not exists transaction_unit text,
 add column if not exists transaction_unit_price numeric,
 add column if not exists conversion_factor numeric;

CREATE OR REPLACE FUNCTION public.submit_fnb_warehouse_order(p_branch_id uuid, p_warehouse_id uuid, p_request_id uuid, p_items jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare actor uuid:=auth.uid(); tenant uuid; supplier record; customer record; product record;
 payload jsonb; previous record; item jsonb; rows_json jsonb:='[]'; price numeric; qty numeric;
 factor numeric; input_unit text; price_result jsonb; po jsonb; order_id uuid; order_code text; subtotal numeric:=0; n integer;
begin
 perform get_fnb_warehouse_order_context(p_branch_id,'');
 select tenant_id into tenant from profiles where id=actor and is_active;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Thiếu mã gửi hoặc danh sách hàng.'; end if;
 n:=jsonb_array_length(p_items);
 if n<1 or n>500 or length(coalesce(p_note,''))>10000 then raise exception 'Đơn cần từ 1 đến 500 mặt hàng; ghi chú tối đa 10000 ký tự.'; end if;
 if (select count(distinct value->>'productId') from jsonb_array_elements(p_items))<>n then raise exception 'Mặt hàng bị trùng.'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where
 x ? 'note' and (jsonb_typeof(x->'note') not in ('string','null') or length(x->>'note')>2000)) then
 raise exception 'Ghi chú mỗi mặt hàng phải là văn bản, tối đa 2000 ký tự.'; end if;
 -- Empty/absent notes retain the old canonical shape, so old clients and retries remain compatible.
 -- Canonical payload excludes client-supplied prices and display names.
 select jsonb_build_object('branch',p_branch_id,'warehouse',p_warehouse_id,'note',p_note,'items',
 jsonb_agg(jsonb_build_object('productId',(value->>'productId')::uuid,'quantity',(value->>'quantity')::numeric) || case when nullif(trim(value->>'unit'),'') is null then '{}'::jsonb else jsonb_build_object('unit',trim(value->>'unit'),'expectedFactor',value->'expectedFactor') end || case when nullif(value->>'note','') is null then '{}'::jsonb else jsonb_build_object('note',value->>'note') end order by value->>'productId'))
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
 and product_type='sku' and channel is distinct from 'fnb' and inventory_role is distinct from 'fnb_menu_item'
 and inventory_role is distinct from 'fnb_stock_item' and coalesce(is_fnb_stock_item,false)=false
 and code not ilike 'WS%' and name not ilike 'WS%' and name not ilike 'FECA%' -- FNB_WHOLESALE_CATALOG_BOUNDARY
 for share;
 if not found then raise exception 'Mặt hàng không còn được phép đặt kho tổng.'; end if;
 input_unit:=coalesce(nullif(trim(item->>'unit'),''),product.unit);
 factor:=public.resolve_product_uom_factor(tenant,product.id,input_unit);
 if item ? 'expectedFactor' and item->>'expectedFactor' is not null and round((item->>'expectedFactor')::numeric,12)<>round(factor,12) then raise exception 'UOM_CONVERSION_CHANGED'; end if;
 if round(qty*factor,4)<=0 or qty*factor>100000000 then raise exception 'UOM_QUANTITY_INVALID'; end if;
 price_result:=resolve_sale_price_00363(product.id,null,p_warehouse_id,customer.id,'retail','direct',round(qty*factor,4),now());
 price:=(price_result->>'unit_price')::numeric*factor;
 if price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or (price=0 and not coalesce(product.allow_free_sale,false)) then raise exception 'Mặt hàng chưa có giá bán nội bộ hợp lệ.'; end if;
 rows_json:=rows_json||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit',input_unit,'quantity',qty,'unit_price',price,'discount',0,'vat_rate',0,'note',nullif(item->>'note','')));
 -- Match existing PO rounding; this remains an estimate, not a posting.
 subtotal:=subtotal+ceil(qty*price);
 end loop;
 -- Existing PO engine supplies UOM snapshots. receive_now=false: no stock/cash posting.
 po:=save_purchase_order_with_uom_atomic(null,null,p_branch_id,supplier.id,p_note,0,0,0,0,'cash',true,false,rows_json);
 -- Existing PO save owns pricing/UOM/numbering; add literal line notes before the immutable link is created.
 update purchase_order_items pi set note=nullif(x->>'note','')
 from jsonb_array_elements(p_items) x where pi.purchase_order_id=(po->>'purchase_order_id')::uuid
 and pi.product_id=(x->>'productId')::uuid;
 select total into subtotal from public.purchase_orders where id=(po->>'purchase_order_id')::uuid;
 order_code:=next_code(tenant,'order');
 insert into invoices(tenant_id,branch_id,code,customer_id,customer_name,status,source,subtotal,discount_amount,tax_amount,delivery_fee,total,paid,debt,payment_method,note,created_by,auto_saved)
 values(tenant,p_warehouse_id,order_code,customer.id,customer.name,'draft','order',subtotal,0,0,0,subtotal,0,subtotal,'cash',p_note,actor,false) returning id into order_id;
 insert into invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,note,transaction_quantity,transaction_unit,transaction_unit_price,conversion_factor)
 select order_id,pi.product_id,pi.product_name,pi.unit,pi.quantity,pi.unit_price,0,ceil(pi.transaction_quantity*pi.transaction_unit_price),pi.note,pi.transaction_quantity,pi.transaction_unit,pi.transaction_unit_price,pi.conversion_factor from public.purchase_order_items pi where pi.purchase_order_id=(po->>'purchase_order_id')::uuid;
 insert into fnb_purchase_sales_order_links(tenant_id,purchase_order_id,sales_order_id,request_id,request_payload,created_by)
 values(tenant,(po->>'purchase_order_id')::uuid,order_id,p_request_id,payload,actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(tenant,actor,'fnb_warehouse_order_submitted','sales_order',order_id,jsonb_build_object('purchase_order_id',po->>'purchase_order_id','branch_id',p_branch_id));
 return jsonb_build_object('purchaseOrderId',po->>'purchase_order_id','code',po->>'code','salesOrderId',order_id,'salesOrderCode',order_code,'total',subtotal);
end; $function$
;

CREATE OR REPLACE FUNCTION public.change_fnb_warehouse_order(p_purchase_order_id uuid, p_expected_revision integer, p_request_id uuid, p_action text, p_items jsonb DEFAULT NULL::jsonb, p_note text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); tenant uuid; link record; po record; so record; previous record;
 payload jsonb; canonical jsonb; item jsonb; product record; price numeric; qty numeric;
 factor numeric; input_unit text; rows_json jsonb:='[]'; v_subtotal numeric:=0; before_data jsonb; v_result jsonb; blocked text; n integer;
begin
 select tenant_id into tenant from public.profiles where id=actor and is_active;
 if tenant is null or not public.user_has_permission(actor,'inventory.create_po') then
 raise exception 'Không có quyền sửa/hủy phiếu đặt kho tổng.' using errcode='42501'; end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_action not in ('edit','cancel') or p_action is null
 or length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>1000 then raise exception 'Nhập lý do thay đổi/hủy từ 3 đến 1000 ký tự.'; end if;
 select * into link from public.fnb_purchase_sales_order_links where purchase_order_id=p_purchase_order_id and tenant_id=tenant;
 if not found then raise exception 'Không tìm thấy phiếu đặt kho tổng.' using errcode='42501'; end if;
 -- Match warehouse child-creation FOR SHARE lock; no child can be copied mid-change.
 select * into so from public.invoices where id=link.sales_order_id and tenant_id=tenant for update;
 if not found then raise exception 'Liên kết đơn kho tổng chưa đầy đủ.'; end if;
 select * into link from public.fnb_purchase_sales_order_links where purchase_order_id=p_purchase_order_id and tenant_id=tenant for update;
 select * into po from public.purchase_orders where id=p_purchase_order_id and tenant_id=tenant for update;
 if not found then raise exception 'Liên kết phiếu đặt chưa đầy đủ.'; end if;
 if not public.user_has_branch_access(actor,po.branch_id) then raise exception 'Không có quyền tại chi nhánh đặt hàng.' using errcode='42501'; end if;
 if p_action='edit' then
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Danh sách hàng không hợp lệ.'; end if;
 n:=jsonb_array_length(p_items);
 if n<1 or n>500 or length(coalesce(p_note,''))>10000 then raise exception 'Đơn cần 1–500 mặt hàng, ghi chú tối đa 10000 ký tự.'; end if;
 if (select count(distinct x->>'productId') from jsonb_array_elements(p_items) x)<>n then raise exception 'Mặt hàng bị trùng.'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where x ? 'note' and (jsonb_typeof(x->'note') not in ('string','null') or length(x->>'note')>2000)) then raise exception 'Ghi chú mặt hàng tối đa 2000 ký tự.'; end if;
 select jsonb_agg(jsonb_build_object('productId',(x->>'productId')::uuid,'quantity',(x->>'quantity')::numeric,'note',nullif(x->>'note','')) || case when nullif(trim(x->>'unit'),'') is null then '{}'::jsonb else jsonb_build_object('unit',trim(x->>'unit'),'expectedFactor',x->'expectedFactor') end order by x->>'productId') into canonical from jsonb_array_elements(p_items) x;
 end if;
 payload:=jsonb_build_object('po',p_purchase_order_id,'revision',p_expected_revision,'action',p_action,'items',canonical,'note',case when p_action='edit' then p_note end,'reason',p_reason);
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||p_request_id::text,0));
 select * into previous from private.fnb_order_changes where tenant_id=tenant and request_id=p_request_id;
 if found then
 if previous.actor_id<>actor or previous.payload is distinct from payload or previous.active then raise exception 'Mã thay đổi đã dùng cho nội dung khác.'; end if;
 return previous.result; end if;
 if link.revision<>p_expected_revision then raise exception 'Phiếu vừa được thay đổi. Đóng rồi mở lại trước khi sửa/hủy.' using errcode='40001'; end if;
 blocked:=private.fnb_order_change_block_reason(po.id);
 if blocked is not null then raise exception '%',blocked; end if;
 before_data:=jsonb_build_object('revision',link.revision,'status',po.status,'note',so.note,
 'items',(select jsonb_agg(to_jsonb(x) order by x.id) from public.invoice_items x where x.invoice_id=so.id));
 if p_action='edit' then
 -- Same catalogue, server pricing and UOM engine as submission; no receipt/payment.
 perform public.get_fnb_warehouse_order_context(po.branch_id,'');
 for item in select value from jsonb_array_elements(canonical) loop
 qty:=(item->>'quantity')::numeric;
 if qty is null or qty::text in ('NaN','Infinity','-Infinity') or qty<=0 or qty>100000000 or qty<>round(qty,4) then raise exception 'Số lượng không hợp lệ.'; end if;
 select * into product from public.products where id=(item->>'productId')::uuid and tenant_id=tenant and is_active
 and product_type='sku' and channel is distinct from 'fnb' and inventory_role is distinct from 'fnb_menu_item'
 and inventory_role is distinct from 'fnb_stock_item' and coalesce(is_fnb_stock_item,false)=false
 and code not ilike 'WS%' and name not ilike 'WS%' and name not ilike 'FECA%' -- FNB_WHOLESALE_CATALOG_BOUNDARY
 for share;
 if not found then raise exception 'Mặt hàng không còn được phép đặt kho tổng.'; end if;
 input_unit:=coalesce(nullif(trim(item->>'unit'),''),product.unit);
 factor:=public.resolve_product_uom_factor(tenant,product.id,input_unit);
 if item ? 'expectedFactor' and item->>'expectedFactor' is not null and round((item->>'expectedFactor')::numeric,12)<>round(factor,12) then raise exception 'UOM_CONVERSION_CHANGED'; end if;
 if round(qty*factor,4)<=0 or qty*factor>100000000 then raise exception 'UOM_QUANTITY_INVALID'; end if;
 price:= (public.resolve_sale_price_00363(product.id,null,so.branch_id,so.customer_id,'retail','direct',round(qty*factor,4),now())->>'unit_price')::numeric*factor;
 if price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or(price=0 and not coalesce(product.allow_free_sale,false)) then raise exception 'Mặt hàng chưa có giá nội bộ hợp lệ.'; end if;
 rows_json:=rows_json||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit',input_unit,'quantity',qty,'unit_price',price,'discount',0,'vat_rate',0,'note',item->>'note'));
 v_subtotal:=v_subtotal+ceil(qty*price);
 end loop;
 end if;
 insert into private.fnb_order_changes(tenant_id,request_id,actor_id,purchase_order_id,sales_order_id,payload,transaction_id)
 values(tenant,p_request_id,actor,po.id,so.id,payload,txid_current());
 if p_action='cancel' then
 update public.purchase_orders set status='cancelled',updated_at=now() where id=po.id;
 update public.invoices set status='cancelled',updated_at=now() where id=so.id;
 else
 -- Ordered demand has no receiving effects; temporarily draft inside this transaction
 -- solely to reuse the existing UOM save engine's strict draft-only edit contract.
 update public.purchase_orders set status='draft' where id=po.id;
 perform public.save_purchase_order_with_uom_atomic(po.id,po.code,po.branch_id,po.supplier_id,p_note,0,0,0,0,'cash',true,false,rows_json);
 select total into v_subtotal from public.purchase_orders where id=po.id;
 update public.purchase_orders set note=p_note where id=po.id;
 update public.purchase_order_items pi set note=x->>'note' from jsonb_array_elements(rows_json) x
 where pi.purchase_order_id=po.id and pi.product_id=(x->>'product_id')::uuid;
 delete from public.invoice_items where invoice_id=so.id;
 insert into public.invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,note,transaction_quantity,transaction_unit,transaction_unit_price,conversion_factor)
 select so.id,pi.product_id,pi.product_name,pi.unit,pi.quantity,pi.unit_price,0,ceil(pi.transaction_quantity*pi.transaction_unit_price),pi.note,pi.transaction_quantity,pi.transaction_unit,pi.transaction_unit_price,pi.conversion_factor from public.purchase_order_items pi where pi.purchase_order_id=po.id;
 update public.invoices set note=p_note,subtotal=v_subtotal,total=v_subtotal,debt=v_subtotal,updated_at=now() where id=so.id;
 end if;
 update public.fnb_purchase_sales_order_links set revision=revision+1 where purchase_order_id=po.id;
 v_result:=jsonb_build_object('purchaseOrderId',po.id,'salesOrderId',so.id,'code',po.code,'salesOrderCode',so.code,'revision',link.revision+1,'action',p_action);
 update private.fnb_order_changes set active=false,result=v_result where tenant_id=tenant and request_id=p_request_id;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(tenant,actor,'fnb_warehouse_order_'||p_action,'purchase_order',po.id,before_data,
 jsonb_build_object('revision',link.revision+1,'sales_order_id',so.id,'reason',p_reason,'request_id',p_request_id,'action',p_action,'note',case when p_action='edit' then p_note else so.note end,'items',case when p_action='edit' then canonical else before_data->'items' end));
 return v_result;
end $function$
;

CREATE OR REPLACE FUNCTION public.save_sales_order_atomic(p_order_id uuid, p_requested_code text, p_branch_id uuid, p_customer_id uuid, p_items jsonb, p_delivery_fee numeric, p_note text, p_partner_id uuid, p_receiver_name text, p_receiver_phone text, p_receiver_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_branch_id uuid := p_branch_id;
  v_order record;
  v_order_id uuid;
  v_code text;
  v_customer_name text := 'Khách lẻ';
  v_product record;
  v_item jsonb;
  v_product_id uuid;
  v_quantity numeric; v_factor numeric; v_lines jsonb:='[]'::jsonb;
  v_unit_price numeric;
  v_subtotal numeric := 0;
  v_total numeric;
  v_delivery_fee numeric := coalesce(p_delivery_fee, 0);
  v_name text := nullif(trim(coalesce(p_receiver_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_receiver_phone, '')), '');
  v_address text := nullif(trim(coalesce(p_receiver_address, '')), '');
  v_shipment record;
  v_shipment_id uuid;
  v_shipment_code text;
  v_created boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id
    from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  if not public.user_has_permission(v_actor, 'orders.create') then
    raise exception using errcode = '42501', message = 'ORDER_SAVE_DENIED';
  end if;
  if v_delivery_fee < 0 or v_delivery_fee = 'NaN'::numeric then
    raise exception using errcode = '22023', message = 'ORDER_DELIVERY_FEE_INVALID';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 1000 then
    raise exception using errcode = '22023', message = 'ORDER_ITEMS_INVALID';
  end if;
  if num_nonnulls(v_name, v_phone, v_address) not in (0, 3) then
    raise exception using errcode = '22023', message = 'SHIPMENT_RECEIVER_INCOMPLETE';
  end if;

  if p_order_id is null then
    if not exists (
      select 1 from public.branches b
      where b.id = v_branch_id and b.tenant_id = v_tenant_id and coalesce(b.is_active, true)
    ) or not public.user_has_branch_access(v_actor, v_branch_id) then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
    end if;
    v_code := nullif(trim(coalesce(p_requested_code, '')), '');
    if v_code is null then
      v_code := public.next_code(v_tenant_id, 'order');
    elsif length(v_code) > 50 then
      raise exception using errcode = '22023', message = 'ORDER_CODE_INVALID';
    end if;
    v_created := true;
  else
    select i.id, i.code, i.branch_id, i.status, i.source, i.paid
      into v_order
      from public.invoices i
     where i.id = p_order_id
       and i.tenant_id = v_tenant_id
       and i.deleted_at is null
     for update;
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_NOT_FOUND';
    end if;
    if v_order.status <> 'draft' or v_order.source <> 'order' or coalesce(v_order.paid, 0) <> 0 then
      raise exception using errcode = '22023', message = 'ORDER_NOT_EDITABLE';
    end if;
    if v_branch_id is not null and v_branch_id <> v_order.branch_id then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_MISMATCH';
    end if;
    if not public.user_has_branch_access(v_actor, v_order.branch_id) then
      raise exception using errcode = '42501', message = 'ORDER_BRANCH_DENIED';
    end if;
    if nullif(trim(coalesce(p_requested_code, '')), '') is not null
       and trim(p_requested_code) <> v_order.code then
      raise exception using errcode = '22023', message = 'ORDER_CODE_IMMUTABLE';
    end if;
    v_branch_id := v_order.branch_id;
    v_code := v_order.code;
  end if;

  if p_customer_id is not null then
    select c.name into v_customer_name
      from public.customers c
     where c.id = p_customer_id
       and c.tenant_id = v_tenant_id
       and coalesce(c.is_active, true);
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_CUSTOMER_INVALID';
    end if;
  end if;
  if p_partner_id is not null and not exists (
    select 1 from public.delivery_partners dp
    where dp.id = p_partner_id
      and dp.tenant_id = v_tenant_id
      and coalesce(dp.is_active, true)
  ) then
    raise exception using errcode = '22023', message = 'DELIVERY_PARTNER_INVALID';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_product_id := nullif(v_item->>'product_id', '')::uuid;
      v_quantity := nullif(v_item->>'quantity', '')::numeric;
      v_unit_price := nullif(v_item->>'unit_price', '')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'ORDER_ITEM_INVALID';
    end;
    if v_product_id is null
       or v_quantity is null or v_quantity <= 0 or v_quantity = 'NaN'::numeric
       or v_unit_price is null or v_unit_price < 0 or v_unit_price = 'NaN'::numeric then
      raise exception using errcode = '22023', message = 'ORDER_ITEM_INVALID';
    end if;
    select p.id, p.name, p.unit into v_product
      from public.products p
     where p.id = v_product_id
       and p.tenant_id = v_tenant_id
       and coalesce(p.is_active, true)
       and coalesce(p.product_type, 'sku') = 'sku';
    if not found then
      raise exception using errcode = '22023', message = 'ORDER_PRODUCT_INVALID';
    end if;
    v_factor:=public.resolve_product_uom_factor(v_tenant_id,v_product_id,coalesce(nullif(trim(v_item->>'unit'),''),v_product.unit));
    if round(v_quantity*v_factor,4)<=0 or round(round(v_quantity*v_factor,4)*round(v_unit_price/v_factor,8),2)<>round(v_quantity*v_unit_price,2) then raise exception 'UOM_QUANTITY_PRECISION_INVALID'; end if;
    v_lines:=v_lines||jsonb_build_array(v_item||jsonb_build_object('resolved_factor',v_factor,'resolved_stock_unit',v_product.unit));
    v_subtotal := v_subtotal + round(v_quantity * v_unit_price, 2);
  end loop;
  v_total := v_subtotal + v_delivery_fee;

  if v_created then
    insert into public.invoices (
      tenant_id, branch_id, code, customer_id, customer_name, status, source,
      subtotal, discount_amount, tax_amount, delivery_fee, total, paid, debt,
      payment_method, note, created_by, auto_saved
    ) values (
      v_tenant_id, v_branch_id, v_code, p_customer_id, v_customer_name, 'draft', 'order',
      v_subtotal, 0, 0, v_delivery_fee, v_total, 0, v_total,
      'cash', nullif(trim(coalesce(p_note, '')), ''), v_actor, false
    ) returning id into v_order_id;
  else
    v_order_id := p_order_id;
    update public.invoices
       set customer_id = p_customer_id, customer_name = v_customer_name,
           subtotal = v_subtotal, discount_amount = 0, tax_amount = 0,
           delivery_fee = v_delivery_fee, total = v_total, paid = 0, debt = v_total,
           note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
     where id = v_order_id and tenant_id = v_tenant_id and status = 'draft' and source = 'order';
    delete from public.invoice_items ii where ii.invoice_id = v_order_id;
  end if;

  for v_item in select value from jsonb_array_elements(v_lines)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    select p.id, p.name, p.unit into v_product
      from public.products p where p.id = v_product_id and p.tenant_id = v_tenant_id;
    if v_product.unit is distinct from v_item->>'resolved_stock_unit' then raise exception 'UOM_PRODUCT_UNIT_CHANGED'; end if;
    v_factor:=(v_item->>'resolved_factor')::numeric;
    insert into public.invoice_items (
      invoice_id, product_id, product_name, unit, quantity, unit_price, discount, total, note, transaction_quantity, transaction_unit, transaction_unit_price, conversion_factor
    ) values (
      v_order_id, v_product_id, v_product.name, coalesce(v_product.unit, 'Cái'),
      round(v_quantity*v_factor,4), round(v_unit_price/v_factor,8), 0, round(v_quantity * v_unit_price, 2),
      nullif(trim(coalesce(v_item->>'note', '')), ''),v_quantity,coalesce(nullif(trim(v_item->>'unit'),''),v_product.unit),v_unit_price,v_factor
    );
  end loop;

  select so.id, so.code, so.status into v_shipment
    from public.shipping_orders so
   where so.tenant_id = v_tenant_id
     and so.invoice_id = v_order_id
     and so.status not in ('cancelled', 'returned')
   order by so.created_at desc limit 1 for update;

  if found then
    v_shipment_id := v_shipment.id;
    v_shipment_code := v_shipment.code;
    update public.shipping_orders
       set shipping_fee = v_delivery_fee, cod_amount = v_total,
           partner_id = coalesce(p_partner_id, partner_id), updated_at = now()
     where id = v_shipment.id and tenant_id = v_tenant_id;
  elsif v_name is not null then
    v_shipment_code := public.next_code(v_tenant_id, 'shipping_order');
    insert into public.shipping_orders (
      tenant_id, invoice_id, partner_id, code, status, shipping_fee, cod_amount,
      receiver_name, receiver_phone, receiver_address, note
    ) values (
      v_tenant_id, v_order_id, p_partner_id, v_shipment_code, 'pending',
      v_delivery_fee, v_total, v_name, v_phone, v_address,
      nullif(trim(coalesce(p_note, '')), '')
    ) returning id into v_shipment_id;
  end if;

  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (
    v_tenant_id, v_actor,
    case when v_created then 'sales_order_created' else 'sales_order_updated' end,
    'sales_order', v_order_id,
    jsonb_build_object(
      'code', v_code, 'branch_id', v_branch_id, 'customer_id', p_customer_id,
      'item_count', jsonb_array_length(p_items), 'subtotal', v_subtotal,
      'delivery_fee', v_delivery_fee, 'total', v_total,
      'shipment_id', v_shipment_id, 'atomic', true
    )
  );

  return jsonb_build_object(
    'order_id', v_order_id, 'order_code', v_code, 'total', v_total,
    'shipment_id', v_shipment_id, 'shipment_code', v_shipment_code,
    'created', v_created
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_fnb_warehouse_order_for_change(p_purchase_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p record; s record; rows_json jsonb; tenant uuid;
begin
 select tenant_id into tenant from public.profiles where id=auth.uid() and is_active;
 select po.*,l.sales_order_id,l.revision into p from public.purchase_orders po
 join public.fnb_purchase_sales_order_links l on l.purchase_order_id=po.id and l.tenant_id=po.tenant_id
 where po.id=p_purchase_order_id and po.tenant_id=tenant;
 if not found or not public.user_has_permission(auth.uid(),'inventory.view')
 or not public.user_has_branch_access(auth.uid(),p.branch_id) then raise exception 'Không có quyền xem phiếu đặt kho tổng.' using errcode='42501'; end if;
 select * into s from public.invoices where id=p.sales_order_id and tenant_id=tenant;
 if not found then raise exception 'Liên kết đơn kho tổng chưa đầy đủ.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',ii.product_id,'code',pr.code,'name',ii.product_name,
 'unit',coalesce(ii.transaction_unit,ii.unit),'quantity',coalesce(ii.transaction_quantity,ii.quantity),'note',coalesce(ii.note,'')) order by ii.id),'[]') into rows_json
 from public.invoice_items ii join public.products pr on pr.id=ii.product_id and pr.tenant_id=tenant where ii.invoice_id=s.id;
 return jsonb_build_object('purchaseOrderId',p.id,'code',p.code,'salesOrderCode',s.code,'branchId',p.branch_id,
 'warehouseId',s.branch_id,'revision',p.revision,'items',rows_json,'note',coalesce(s.note,''),
 'blockedReason',private.fnb_order_change_block_reason(p.id));
end $function$
;

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
 v_unit text; v_factor numeric; v_normalized jsonb:='[]'::jsonb;
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
  -- retail_internal_source_00574: warehouse export is not destination POS access.
  if not public.user_has_branch_access(v_actor, p_from_branch_id)
     or (not public.user_has_branch_access(v_actor, p_to_branch_id) and not exists (
       select 1 from public.branches src join public.branches dst on dst.tenant_id=src.tenant_id
       where src.id=p_from_branch_id and src.tenant_id=v_tenant_id
         and src.is_active and src.branch_type='warehouse'
         and dst.id=p_to_branch_id and dst.is_active
     )) then
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
 v_factor:=public.resolve_product_uom_factor(v_tenant_id,v_product_id,coalesce(nullif(trim(v_item->>'unit'),''),v_product.unit));
 if round(v_qty*v_factor,4)<=0 or round(round(v_qty*v_factor,4)*round(v_unit_price/v_factor,8))<>round(v_qty*v_unit_price) then raise exception 'UOM_QUANTITY_PRECISION_INVALID'; end if;
 v_normalized:=v_normalized||jsonb_build_array(v_item||jsonb_build_object(
   'quantity',round(v_qty*v_factor,4),'unit',v_product.unit,'unitPrice',round(v_unit_price/v_factor,8),
   'transactionQuantity',v_qty,'transactionUnit',coalesce(nullif(trim(v_item->>'unit'),''),v_product.unit),
   'transactionUnitPrice',v_unit_price,'conversionFactor',v_factor));
 v_line_amount := round(v_qty * v_unit_price);
 v_line_tax := round(v_line_amount * v_vat_rate / 100);
 v_subtotal := v_subtotal + v_line_amount;
 v_tax_total := v_tax_total + v_line_tax;
 end loop;
 p_items:=v_normalized;
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
 quantity, unit_price, discount, vat_rate, vat_amount, total, transaction_quantity, transaction_unit, transaction_unit_price, conversion_factor
 ) values (
 v_invoice_id, v_product_id, v_product_name, coalesce(v_unit, 'Cai'),
 v_qty, v_unit_price, 0, v_vat_rate, v_line_tax,
 v_line_amount + v_line_tax,(v_item->>'transactionQuantity')::numeric,v_item->>'transactionUnit',(v_item->>'transactionUnitPrice')::numeric,(v_item->>'conversionFactor')::numeric
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
 quantity, unit_price, vat_rate, amount, note, transaction_quantity, transaction_unit, transaction_unit_price, conversion_factor
 ) values (
 v_sale_id, v_product_id, v_product_code, v_product_name,
 coalesce(v_unit, 'Cai'), v_qty, v_unit_price, v_vat_rate,
 v_line_amount, nullif(v_item->>'note', ''),(v_item->>'transactionQuantity')::numeric,v_item->>'transactionUnit',(v_item->>'transactionUnitPrice')::numeric,(v_item->>'conversionFactor')::numeric
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

-- BEGIN scoped snapshot view
create or replace view public.invoice_items_scoped as SELECT id,
    invoice_id,
    product_id,
    product_name,
    unit,
    quantity,
    unit_price,
    discount,
    total,
    vat_rate,
    vat_amount,
    returned_qty,
        CASE
            WHEN user_has_permission(auth.uid(), 'products.view_cost'::text) THEN unit_cost
            ELSE 0::numeric
        END AS unit_cost,
    note,
    variant_id,
    fnb_gross_amount, transaction_quantity, transaction_unit, transaction_unit_price, conversion_factor
   FROM invoice_items t
  WHERE (EXISTS ( SELECT 1
           FROM invoices o
          WHERE o.id = t.invoice_id AND _can_read_branch_inventory_00476(auth.uid(), o.tenant_id, o.branch_id))) AND (EXISTS ( SELECT 1
           FROM profiles p
          WHERE p.id = auth.uid() AND COALESCE(p.is_active, true)));
-- END scoped snapshot view

notify pgrst, 'reload schema'; commit;