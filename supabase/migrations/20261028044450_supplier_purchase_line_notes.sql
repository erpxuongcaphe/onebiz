-- Preserve the existing UOM, expiry, receipt/cost and replay-safe implementations.
-- Notes are saved in the same transaction; this never edits old documents on install.
alter function public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb)
 rename to _supplier_po_base_20261028;
revoke all on function public._supplier_po_base_20261028(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb) from public,anon,authenticated;

create function public.save_purchase_order_with_uom_atomic(
 p_purchase_order_id uuid,p_requested_code text,p_branch_id uuid,p_supplier_id uuid,p_note text,
 p_shipping_cost numeric,p_other_cost numeric,p_order_discount numeric,p_paid_amount numeric,
 p_payment_method text,p_mark_ordered boolean,p_receive_now boolean,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; item jsonb; order_id uuid; tenant uuid; actor uuid:=auth.uid();
begin
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if actor is null or tenant is null then raise exception using errcode='42501',message='ACTIVE_PROFILE_REQUIRED'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'PURCHASE_ORDER_ITEMS_INVALID'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where x ? 'note' and
   (jsonb_typeof(x->'note') not in ('string','null') or length(x->>'note')>2000)) then
   raise exception using errcode='22023',message='Ghi chú mặt hàng tối đa 2000 ký tự.';
 end if;
 result:=public._supplier_po_base_20261028(p_purchase_order_id,p_requested_code,p_branch_id,p_supplier_id,p_note,
   p_shipping_cost,p_other_cost,p_order_discount,p_paid_amount,p_payment_method,p_mark_ordered,p_receive_now,p_items);
 order_id:=(result->>'purchase_order_id')::uuid;
 -- Base function enforces create_po permission, original branch, editable draft and receipt guards.
 for item in select value from jsonb_array_elements(p_items) loop
   if item ? 'note' then
     update public.purchase_order_items pi set note=nullif(trim(item->>'note'),'')
     from public.purchase_orders po where po.id=order_id and po.tenant_id=tenant
       and pi.purchase_order_id=po.id and pi.product_id=(item->>'product_id')::uuid;
     if not found then raise exception 'PURCHASE_ORDER_LINE_NOTE_FAILED'; end if;
   end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(p_items) x where nullif(trim(x->>'note'),'') is not null) then
   insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
   values(tenant,actor,'purchase_order_line_notes','purchase_order',order_id,
     jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('product_id',x->>'product_id','note',x->>'note')) from jsonb_array_elements(p_items) x)));
 end if;
 return result;
end $$;
revoke all on function public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb) from public,anon;
grant execute on function public.save_purchase_order_with_uom_atomic(uuid,text,uuid,uuid,text,numeric,numeric,numeric,numeric,text,boolean,boolean,jsonb) to authenticated;
