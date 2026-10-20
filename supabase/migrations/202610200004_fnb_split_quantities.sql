begin;
-- Explicit remaining quantities; no live order is changed by installation.
create function public.split_kitchen_order_quantities_20261020(p_order_id uuid,p_items jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 actor uuid:=auth.uid(); tenant uuid; ord public.kitchen_orders%rowtype;
 original public.kitchen_order_items%rowtype; cloned public.kitchen_order_items%rowtype;
 entry jsonb; qty integer; expected integer; available integer; total_qty bigint; selected_qty bigint:=0;
 selected_ids uuid[]:='{}'; seen uuid[]:='{}'; item_id uuid; new_id uuid;
 replay jsonb; result jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not coalesce(public.user_has_permission(actor,'pos_fnb.split_bill'),false) then raise exception 'SPLIT_BILL_PERMISSION_REQUIRED' using errcode='42501'; end if;
 select * into ord from public.kitchen_orders where id=p_order_id and tenant_id=tenant for update;
 if not found then raise exception 'KITCHEN_ORDER_NOT_FOUND' using errcode='22023'; end if;
 if not coalesce(public.user_has_branch_access(actor,ord.branch_id),false) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'SPLIT_REQUEST_REQUIRED' using errcode='22023'; end if;
 select new_data into replay from public.audit_log where tenant_id=tenant and user_id=actor and entity_id=ord.id
   and action='fnb_split_quantities' and new_data->>'request_id'=p_request_id::text limit 1;
 if found then
   if replay->'selection' is distinct from p_items then raise exception 'SPLIT_REQUEST_CHANGED' using errcode='22023'; end if;
   return replay->'result';
 end if;
 if ord.invoice_id is not null or ord.status not in ('pending','preparing','ready','served') or ord.merged_into_id is not null then raise exception 'KITCHEN_ORDER_NOT_SPLITTABLE' using errcode='22023'; end if;
 if ord.order_type='delivery' then raise exception 'DELIVERY_ORDER_CANNOT_SPLIT' using errcode='22023'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'SPLIT_ITEM_SELECTION_INVALID' using errcode='22023'; end if;
 perform id from public.kitchen_order_items where kitchen_order_id=ord.id order by id for update;
 select coalesce(sum(quantity),0) into total_qty from public._fnb_active_kitchen_items_00454 where kitchen_order_id=ord.id;
 -- Validate every row before materializing any partial line.
 for entry in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(entry->'quantity') is distinct from 'number' or jsonb_typeof(entry->'expected_quantity') is distinct from 'number'
      or (entry->>'quantity')::numeric<>trunc((entry->>'quantity')::numeric)
      or (entry->>'expected_quantity')::numeric<>trunc((entry->>'expected_quantity')::numeric) then raise exception 'SPLIT_QUANTITY_INVALID' using errcode='22023'; end if;
   item_id:=(entry->>'item_id')::uuid; qty:=(entry->>'quantity')::integer; expected:=(entry->>'expected_quantity')::integer;
   if item_id is null or item_id=any(seen) then raise exception 'SPLIT_ITEM_DUPLICATE' using errcode='22023'; end if;
   seen:=array_append(seen,item_id);
   select * into original from public.kitchen_order_items where id=item_id and kitchen_order_id=ord.id;
   if not found then raise exception 'SPLIT_ITEM_NOT_IN_ORDER' using errcode='22023'; end if;
   available:=original.quantity-coalesce(original.cancelled_qty,0);
   if expected<>available then raise exception 'SPLIT_QUANTITY_CHANGED' using errcode='PT409'; end if;
   if qty<=0 or qty>available then raise exception 'SPLIT_QUANTITY_INVALID' using errcode='22023'; end if;
   selected_qty:=selected_qty+qty;
 end loop;
 if selected_qty>=total_qty then raise exception 'SPLIT_PARENT_EMPTY' using errcode='22023'; end if;
 for entry in select value from jsonb_array_elements(p_items) loop
   select * into original from public.kitchen_order_items where id=(entry->>'item_id')::uuid and kitchen_order_id=ord.id;
   qty:=(entry->>'quantity')::integer;
   if qty=original.quantity then selected_ids:=array_append(selected_ids,original.id);
   else
     -- Keep cancellation history on its original row; snapshot modifiers, toppings,
     -- station and preparation timestamps onto the separated quantity.
     new_id:=gen_random_uuid();
     cloned:=jsonb_populate_record(null::public.kitchen_order_items,to_jsonb(original)||jsonb_build_object('id',new_id,'quantity',qty,'cancelled_qty',0,'batch_id',null));
     update public.kitchen_order_items set quantity=quantity-qty where id=original.id;
     insert into public.kitchen_order_items select cloned.*;
     selected_ids:=array_append(selected_ids,new_id);
   end if;
 end loop;
 -- Existing guarded transaction retains sequential bill codes, proportional
 -- topping-inclusive discount allocation, table association and split audit.
 result:=public.split_kitchen_order_atomic(ord.id,'items',selected_ids,null);
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(tenant,actor,'fnb_split_quantities','kitchen_order',ord.id,jsonb_build_object('request_id',p_request_id,'selection',p_items,'result',result));
 return result;
end $$;
revoke all on function public.split_kitchen_order_quantities_20261020(uuid,jsonb,uuid) from public,anon;
grant execute on function public.split_kitchen_order_quantities_20261020(uuid,jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
