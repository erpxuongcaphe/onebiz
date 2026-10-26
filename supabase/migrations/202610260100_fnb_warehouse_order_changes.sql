-- Explicit branch-demand changes, never stock/cash posting or historical backfill.
begin;
set local lock_timeout='2s';
alter table public.fnb_purchase_sales_order_links add column revision integer not null default 0;
create schema if not exists private;
create table private.fnb_order_changes (
 tenant_id uuid not null, request_id uuid not null, actor_id uuid not null,
 purchase_order_id uuid not null, sales_order_id uuid not null,
 payload jsonb not null, result jsonb, transaction_id bigint not null,
 active boolean not null default true, created_at timestamptz not null default now(),
 primary key(tenant_id,request_id)
);
revoke all on private.fnb_order_changes from public,anon,authenticated;

create function private.fnb_order_change_block_reason(p_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare p record; s record;
begin
 select po.*,l.sales_order_id into p from public.purchase_orders po
 join public.fnb_purchase_sales_order_links l on l.purchase_order_id=po.id where po.id=p_id;
 if not found then return 'Không tìm thấy phiếu đặt kho tổng.'; end if;
 select * into s from public.invoices where id=p.sales_order_id;
 if not found then return 'Liên kết đơn kho tổng chưa đầy đủ. Liên hệ quản trị.'; end if;
 if s.fulfilled_by_id is not null or s.status not in ('draft','cancelled')
 or exists(select 1 from public.invoices c where c.source_order_id=s.id and c.status not in ('draft','cancelled'))
 or exists(select 1 from public.internal_sales x join public.invoices c on c.id=x.invoice_id where c.source_order_id=s.id) then
 return 'Kho đã xuất/giao hàng. Không thể sửa hoặc hủy nhu cầu gốc.'; end if;
 if exists(select 1 from public.invoices c where c.source_order_id=s.id and c.status='draft' and c.deleted_at is null) then
 return 'Kho đang mở đơn bán để xử lý. Nhờ kho hủy nháp xử lý đó trước khi sửa/hủy phiếu đặt.'; end if;
 if p.status not in ('draft','ordered') or coalesce(p.paid,0)<>0
 or exists(select 1 from public.purchase_order_items x where x.purchase_order_id=p.id and coalesce(x.received_quantity,0)<>0)
 or exists(select 1 from public.input_invoices x where x.purchase_order_id=p.id) then
 return 'Phiếu đã nhận hàng hoặc ghi nhận nghiệp vụ. Không thể sửa/hủy nhu cầu gốc.'; end if;
 if s.status='cancelled' or s.deleted_at is not null then return 'Đơn kho tổng đã hủy hoặc không còn chờ xử lý.'; end if;
 return null;
end $$;
revoke all on function private.fnb_order_change_block_reason(uuid) from public,anon,authenticated;

-- A transaction-local permit in a private table, not a client-settable GUC.
-- Existing guard behavior remains unchanged for every other RPC/document.
create or replace function public.guard_fnb_linked_purchase_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare po_id uuid;
begin
 if tg_table_name='purchase_orders' then po_id:=old.id;
 elsif tg_op='DELETE' then po_id:=old.purchase_order_id;
 else po_id:=new.purchase_order_id; end if;
 if tg_table_name<>'input_invoices' and not(tg_table_name='purchase_orders' and tg_op='DELETE')
 and (tg_op<>'UPDATE' or tg_table_name='purchase_orders' or (to_jsonb(old)->>'purchase_order_id') is not distinct from (to_jsonb(new)->>'purchase_order_id'))
 and exists(select 1 from private.fnb_order_changes c where c.transaction_id=txid_current() and c.active and c.purchase_order_id=po_id) then
 if tg_op='DELETE' then return old; end if; return new; end if;
 if tg_table_name='purchase_order_items' and tg_op='UPDATE' then
 if exists(select 1 from public.fnb_purchase_sales_order_links where purchase_order_id=old.purchase_order_id) then
 raise exception 'Không sửa các dòng nhu cầu đã gửi kho tổng.'; end if; end if;
 if exists(select 1 from public.fnb_purchase_sales_order_links where purchase_order_id=po_id) then
 raise exception 'Đơn đã gửi kho tổng. Sử dụng chức năng sửa/hủy phiếu đặt để đồng bộ hai bên.'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create or replace function public.guard_fnb_original_sales_order() returns trigger
language plpgsql security definer set search_path='' as $$
declare so_id uuid;
begin
 if tg_table_name='invoices' then so_id:=old.id;
 elsif tg_op='DELETE' then so_id:=old.invoice_id;
 else so_id:=new.invoice_id; end if;
 if not(tg_table_name='invoices' and tg_op='DELETE')
 and (tg_op<>'UPDATE' or tg_table_name='invoices' or (to_jsonb(old)->>'invoice_id') is not distinct from (to_jsonb(new)->>'invoice_id'))
 and exists(select 1 from private.fnb_order_changes c where c.transaction_id=txid_current() and c.active and c.sales_order_id=so_id) then
 if tg_op='DELETE' then return old; end if; return new; end if;
 if tg_table_name='invoices' then
 if exists(select 1 from public.fnb_purchase_sales_order_links where sales_order_id=old.id) then
 if tg_op='DELETE' then raise exception 'Giữ đơn đặt gốc để đối chiếu; hủy xử lý thay vì xóa.'; end if;
 if (to_jsonb(new)-array['status','updated_at','fulfilled_by_id']) is distinct from (to_jsonb(old)-array['status','updated_at','fulfilled_by_id']) then
 raise exception 'Giữ nguyên nhu cầu gốc; mở Xử lý đặt hàng để chỉnh hàng thực xuất.'; end if; end if;
 else
 if tg_op<>'INSERT' then
 if exists(select 1 from public.fnb_purchase_sales_order_links where sales_order_id=old.invoice_id) then raise exception 'Không sửa mặt hàng đơn đặt gốc.'; end if; end if;
 if tg_op<>'DELETE' then
 if exists(select 1 from public.fnb_purchase_sales_order_links where sales_order_id=new.invoice_id) then raise exception 'Không sửa mặt hàng đơn đặt gốc.'; end if; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

create function public.get_fnb_warehouse_order_for_change(p_purchase_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
 'unit',ii.unit,'quantity',ii.quantity,'note',coalesce(ii.note,'')) order by ii.id),'[]') into rows_json
 from public.invoice_items ii join public.products pr on pr.id=ii.product_id and pr.tenant_id=tenant where ii.invoice_id=s.id;
 return jsonb_build_object('purchaseOrderId',p.id,'code',p.code,'salesOrderCode',s.code,'branchId',p.branch_id,
 'warehouseId',s.branch_id,'revision',p.revision,'items',rows_json,'note',coalesce(s.note,''),
 'blockedReason',private.fnb_order_change_block_reason(p.id));
end $$;

create function public.change_fnb_warehouse_order(p_purchase_order_id uuid,p_expected_revision integer,p_request_id uuid,
 p_action text,p_items jsonb default null,p_note text default null,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; link record; po record; so record; previous record;
 payload jsonb; canonical jsonb; item jsonb; product record; price numeric; qty numeric;
 rows_json jsonb:='[]'; v_subtotal numeric:=0; before_data jsonb; v_result jsonb; blocked text; n integer;
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
 select jsonb_agg(jsonb_build_object('productId',(x->>'productId')::uuid,'quantity',(x->>'quantity')::numeric,'note',nullif(x->>'note','')) order by x->>'productId') into canonical from jsonb_array_elements(p_items) x;
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
 and inventory_role is distinct from 'fnb_stock_item' and coalesce(is_fnb_stock_item,false)=false for share;
 if not found then raise exception 'Mặt hàng không còn được phép đặt kho tổng.'; end if;
 price:= (public.resolve_sale_price_00363(product.id,null,so.branch_id,so.customer_id,'retail','direct',qty,now())->>'unit_price')::numeric;
 if price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or(price=0 and not coalesce(product.allow_free_sale,false)) then raise exception 'Mặt hàng chưa có giá nội bộ hợp lệ.'; end if;
 rows_json:=rows_json||jsonb_build_array(jsonb_build_object('product_id',product.id,'unit',product.unit,'quantity',qty,'unit_price',price,'discount',0,'vat_rate',0,'note',item->>'note'));
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
 update public.purchase_orders set note=p_note where id=po.id;
 update public.purchase_order_items pi set note=x->>'note' from jsonb_array_elements(rows_json) x
 where pi.purchase_order_id=po.id and pi.product_id=(x->>'product_id')::uuid;
 delete from public.invoice_items where invoice_id=so.id;
 insert into public.invoice_items(invoice_id,product_id,product_name,unit,quantity,unit_price,discount,total,note)
 select so.id,p.id,p.name,p.unit,(x->>'quantity')::numeric,(x->>'unit_price')::numeric,0,
 ceil((x->>'quantity')::numeric*(x->>'unit_price')::numeric),x->>'note'
 from jsonb_array_elements(rows_json) x join public.products p on p.id=(x->>'product_id')::uuid and p.tenant_id=tenant;
 update public.invoices set note=p_note,subtotal=v_subtotal,total=v_subtotal,debt=v_subtotal,updated_at=now() where id=so.id;
 end if;
 update public.fnb_purchase_sales_order_links set revision=revision+1 where purchase_order_id=po.id;
 v_result:=jsonb_build_object('purchaseOrderId',po.id,'salesOrderId',so.id,'code',po.code,'salesOrderCode',so.code,'revision',link.revision+1,'action',p_action);
 update private.fnb_order_changes set active=false,result=v_result where tenant_id=tenant and request_id=p_request_id;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(tenant,actor,'fnb_warehouse_order_'||p_action,'purchase_order',po.id,before_data,
 jsonb_build_object('revision',link.revision+1,'sales_order_id',so.id,'reason',p_reason,'request_id',p_request_id,'action',p_action,'note',case when p_action='edit' then p_note else so.note end,'items',case when p_action='edit' then canonical else before_data->'items' end));
 return v_result;
end $$;
revoke all on function public.get_fnb_warehouse_order_for_change(uuid) from public,anon;
revoke all on function public.change_fnb_warehouse_order(uuid,integer,uuid,text,jsonb,text,text) from public,anon;
grant execute on function public.get_fnb_warehouse_order_for_change(uuid),public.change_fnb_warehouse_order(uuid,integer,uuid,text,jsonb,text,text) to authenticated;

create or replace function public.get_fnb_purchase_order_links(p_ids uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('purchaseOrderId',p.id,'salesOrderCode',i.code,
 'processed',i.fulfilled_by_id is not null,'cancelled',i.status='cancelled','revision',l.revision,
 'blockedReason',private.fnb_order_change_block_reason(p.id))),'[]')
 from public.fnb_purchase_sales_order_links l join public.purchase_orders p on p.id=l.purchase_order_id
 join public.invoices i on i.id=l.sales_order_id
 where l.tenant_id=public.get_user_tenant_id() and p.id=any(p_ids[1:500])
 and public.user_has_permission(auth.uid(),'inventory.view') and public.user_has_branch_access(auth.uid(),p.branch_id);
$$;
notify pgrst,'reload schema';
commit;
