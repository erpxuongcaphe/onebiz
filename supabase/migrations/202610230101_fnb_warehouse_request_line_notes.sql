-- Literal employee notes per requested SKU. No changes to stock, money, rights or existing documents.
begin;
set local lock_timeout='2s';
alter table public.purchase_order_items add column if not exists note text;
create or replace function public.submit_fnb_warehouse_order(p_branch_id uuid,p_warehouse_id uuid,p_request_id uuid,p_items jsonb,p_note text default null)
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
 if exists(select 1 from jsonb_array_elements(p_items) x where
 x ? 'note' and (jsonb_typeof(x->'note') not in ('string','null') or length(x->>'note')>2000)) then
 raise exception 'Ghi chú mỗi mặt hàng phải là văn bản, tối đa 2000 ký tự.'; end if;
 -- Empty/absent notes retain the old canonical shape, so old clients and retries remain compatible.
 -- Canonical payload excludes client-supplied prices and display names.
 select jsonb_build_object('branch',p_branch_id,'warehouse',p_warehouse_id,'note',p_note,'items',
 jsonb_agg(jsonb_build_object('productId',(value->>'productId')::uuid,'quantity',(value->>'quantity')::numeric) || case when nullif(value->>'note','') is null then '{}'::jsonb else jsonb_build_object('note',value->>'note') end order by value->>'productId'))
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
 rows_json:=rows_json||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit',product.unit,'quantity',qty,'unit_price',price,'discount',0,'vat_rate',0,'note',nullif(item->>'note','')));
 -- Match existing PO rounding; this remains an estimate, not a posting.
 subtotal:=subtotal+ceil(qty*price);
 end loop;
 -- Existing PO engine supplies UOM snapshots. receive_now=false: no stock/cash posting.
 po:=save_purchase_order_with_uom_atomic(null,null,p_branch_id,supplier.id,p_note,0,0,0,0,'cash',true,false,rows_json);
 -- Existing PO save owns pricing/UOM/numbering; add literal line notes before the immutable link is created.
 update purchase_order_items pi set note=nullif(x->>'note','')
 from jsonb_array_elements(p_items) x where pi.purchase_order_id=(po->>'purchase_order_id')::uuid
 and pi.product_id=(x->>'productId')::uuid;
 order_code:=next_code(tenant,'order');
 insert into invoices(tenant_id,branch_id,code,customer_id,customer_name,status,source,subtotal,discount_amount,tax_amount,delivery_fee,total,paid,debt,payment_method,note,created_by,auto_saved)
 values(tenant,p_warehouse_id,order_code,customer.id,customer.name,'draft','order',subtotal,0,0,0,subtotal,0,subtotal,'cash',p_note,actor,false) returning id into order_id;
 insert into invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,note)
 select order_id,p.id,p.name,p.unit,(x->>'quantity')::numeric,(x->>'unit_price')::numeric,0,ceil((x->>'quantity')::numeric*(x->>'unit_price')::numeric),nullif(x->>'note','')
 from jsonb_array_elements(rows_json) x join products p on p.id=(x->>'product_id')::uuid and p.tenant_id=tenant;
 insert into fnb_purchase_sales_order_links(tenant_id,purchase_order_id,sales_order_id,request_id,request_payload,created_by)
 values(tenant,(po->>'purchase_order_id')::uuid,order_id,p_request_id,payload,actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(tenant,actor,'fnb_warehouse_order_submitted','sales_order',order_id,jsonb_build_object('purchase_order_id',po->>'purchase_order_id','branch_id',p_branch_id));
 return jsonb_build_object('purchaseOrderId',po->>'purchase_order_id','code',po->>'code','salesOrderId',order_id,'salesOrderCode',order_code,'total',subtotal);
end; $$;
revoke all on function public.submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.submit_fnb_warehouse_order(uuid,uuid,uuid,jsonb,text) to authenticated;

commit;
