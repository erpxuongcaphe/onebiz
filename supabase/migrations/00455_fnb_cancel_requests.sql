-- Immutable, bill-specific approval requests. No existing business rows changed.
begin;
set local lock_timeout='3s';
create table if not exists public.fnb_cancel_requests (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 branch_id uuid not null, kitchen_order_id uuid not null references public.kitchen_orders(id),
 requested_by uuid not null references public.profiles(id), reason text not null,
 items jsonb not null, context_hash text not null, whole_bill boolean not null,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '15 minutes',
 otp_id uuid, executed_at timestamptz, result jsonb
);
alter table public.fnb_cancel_requests enable row level security;
revoke all on public.fnb_cancel_requests from public,anon,authenticated;
create index if not exists fnb_cancel_requests_pending on public.fnb_cancel_requests(tenant_id,branch_id,created_at) where executed_at is null;

create or replace function public._fnb_cancel_context_00455(p_order uuid) returns text
language sql stable security definer set search_path=public,extensions as $$
 select md5(jsonb_build_object('table',k.table_id,'invoice',k.invoice_id,'merged',k.merged_into_id,
 'discount',to_jsonb(k)->'discount_amount','fees',to_jsonb(k)->'delivery_fee','platform',to_jsonb(k)->'platform_commission_percent','customer',to_jsonb(k)->'customer_id','items',(select jsonb_agg(jsonb_build_object(
 'id',i.id,'qty',i.quantity-coalesce(i.cancelled_qty,0),'price',i.unit_price,'toppings',i.toppings,
 'variant',i.variant_id,'modifiers',to_jsonb(i)->'modifier_selections','note',i.note) order by i.id) from kitchen_order_items i where i.kitchen_order_id=k.id))::text)
 from kitchen_orders k where k.id=p_order
$$;
revoke all on function public._fnb_cancel_context_00455(uuid) from public,anon,authenticated;

create or replace function public.fnb_request_cancel_00455(p_order_id uuid,p_items jsonb,p_reason text,p_whole_bill boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; k record; r uuid; canonical jsonb; selected numeric; remaining numeric;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null then raise exception 'ACTIVE_PROFILE_REQUIRED'; end if;
 select * into k from kitchen_orders where id=p_order_id and tenant_id=t for update;
 if not found or not coalesce(user_has_branch_access(a,k.branch_id),false) then raise exception 'FNB_CANCEL_BRANCH_ACCESS_DENIED'; end if;
 if not (user_has_permission(a,'pos_fnb.view_orders') or user_has_permission(a,'pos_fnb.cancel_unpaid_order') or user_has_permission(a,'pos_fnb.void')) then raise exception 'PERMISSION_DENIED'; end if;
 if k.invoice_id is not null or k.status not in ('pending','preparing','ready','served') or k.merged_into_id is not null then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 if length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>500 then raise exception 'CANCEL_REASON_REQUIRED'; end if;
 if p_whole_bill then
   select jsonb_agg(jsonb_build_object('id',id,'quantity',quantity-coalesce(cancelled_qty,0)) order by id) into p_items from kitchen_order_items where kitchen_order_id=k.id and quantity>coalesce(cancelled_qty,0);
 end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'INVALID_CANCEL_ITEMS'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e group by e->>'id' having count(*)>1) then raise exception 'DUPLICATE_CANCEL_ITEM'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) e left join kitchen_order_items i on i.id=(e->>'id')::uuid and i.kitchen_order_id=k.id
 where i.id is null or (e->>'quantity')::numeric is null or (e->>'quantity')::numeric<=0
 or (e->>'quantity')::numeric<>trunc((e->>'quantity')::numeric) or (e->>'quantity')::numeric>i.quantity-coalesce(i.cancelled_qty,0)) then raise exception 'INVALID_CANCEL_QUANTITY'; end if;
 select jsonb_agg(jsonb_build_object('id',i.id,'quantity',(e->>'quantity')::integer,'name',i.product_name,'unit_price',i.unit_price,'toppings',i.toppings) order by i.id),sum((e->>'quantity')::numeric)
 into canonical,selected from jsonb_array_elements(p_items) e join kitchen_order_items i on i.id=(e->>'id')::uuid and i.kitchen_order_id=k.id;
 select sum(quantity-coalesce(cancelled_qty,0)) into remaining from kitchen_order_items where kitchen_order_id=k.id;
 if not p_whole_bill and selected>=remaining then raise exception 'USE_WHOLE_BILL_CANCEL'; end if;
 insert into fnb_cancel_requests(tenant_id,branch_id,kitchen_order_id,requested_by,reason,items,context_hash,whole_bill)
 values(t,k.branch_id,k.id,a,trim(p_reason),canonical,_fnb_cancel_context_00455(k.id),p_whole_bill) returning id into r;
 return jsonb_build_object('id',r,'order_id',k.id,'branch_id',k.branch_id,'items',canonical,'whole_bill',p_whole_bill);
end $$;

create or replace function public.fnb_pending_cancel_requests_00455() returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; result jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'pos_fnb.cancel_unpaid_order') then raise exception 'PERMISSION_DENIED'; end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
 select r.id,r.branch_id,k.order_number,r.reason,r.items,r.whole_bill,r.created_at,r.expires_at,p.full_name requested_by_name,
 b.name branch_name,coalesce(to_jsonb(rt)->>'name',to_jsonb(k)->>'order_type','') order_label
 from fnb_cancel_requests r join kitchen_orders k on k.id=r.kitchen_order_id join profiles p on p.id=r.requested_by
 left join branches b on b.id=r.branch_id and b.tenant_id=t left join restaurant_tables rt on rt.id=k.table_id and rt.tenant_id=t
 where r.tenant_id=t and r.executed_at is null and r.expires_at>now() and user_has_branch_access(a,r.branch_id)
 and k.invoice_id is null and k.status in ('pending','preparing','ready','served') and r.context_hash=_fnb_cancel_context_00455(k.id)
 order by r.created_at limit 50) q;
 return result;
end $$;

create or replace function public.fnb_issue_cancel_otp_00455(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; k record; v_issued jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t;
 if not found then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 select * into k from kitchen_orders where id=r.kitchen_order_id for update;
 select * into r from fnb_cancel_requests where id=p_request_id for update;
 if not user_has_permission(a,'pos_fnb.cancel_unpaid_order') or not user_has_branch_access(a,r.branch_id) then raise exception 'PERMISSION_DENIED'; end if;
 if r.executed_at is not null or r.expires_at<=now() or k.invoice_id is not null or k.status not in ('pending','preparing','ready','served') or r.context_hash<>_fnb_cancel_context_00455(k.id) then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 v_issued:=issue_manager_otp(case when r.whole_bill then 'fnb.cancel_unpaid_bill' else 'fnb.cancel_unpaid_item' end,
 jsonb_build_object('entity_id',k.id,'kitchen_order_id',k.id,'request_id',r.id,'context_hash',r.context_hash,'items',r.items,'reason',r.reason),r.branch_id,null::text,null::text);
 update fnb_cancel_requests set otp_id=(v_issued->>'otp_id')::uuid where id=r.id;
 return v_issued;
end $$;

create or replace function public.fnb_execute_cancel_request_00455(p_request_id uuid,p_otp_id uuid default null,p_shift_id uuid default null) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; k record; approver uuid; before_gross numeric; after_gross numeric; old_discount numeric; new_discount numeric; v_result jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t and requested_by=a;
 if not found then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 select * into k from kitchen_orders where id=r.kitchen_order_id and tenant_id=t for update;
 select * into r from fnb_cancel_requests where id=p_request_id for update;
 if not user_has_branch_access(a,r.branch_id) then raise exception 'FNB_CANCEL_BRANCH_ACCESS_DENIED'; end if;
 if r.executed_at is not null then return r.result; end if;
 if r.expires_at<=now() or k.invoice_id is not null or k.status not in ('pending','preparing','ready','served') or r.context_hash<>_fnb_cancel_context_00455(k.id) then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 if p_shift_id is not null and not exists(select 1 from shifts where id=p_shift_id and tenant_id=t and branch_id=r.branch_id and cashier_id=a and status='open') then raise exception 'FNB_CANCEL_SHIFT_NOT_OPEN_FOR_USER_BRANCH'; end if;
 if p_otp_id is null then
   if not (user_has_permission(a,'pos_fnb.cancel_unpaid_order') or user_has_permission(a,'pos_fnb.void')) then raise exception 'OTP_REQUIRED'; end if;
   approver:=a;
 else
   if r.otp_id is distinct from p_otp_id or not exists(select 1 from manager_otp_codes o where o.id=p_otp_id and o.tenant_id=t and o.branch_id=r.branch_id and o.target_meta->>'request_id'=r.id::text and o.target_meta->>'context_hash'=r.context_hash) then raise exception 'FNB_CANCEL_OTP_SCOPE_REQUIRED'; end if;
   approver:=verify_otp_authorization(p_otp_id,case when r.whole_bill then 'fnb.cancel_unpaid_bill' else 'fnb.cancel_unpaid_item' end,a,k.id);
   if not exists(select 1 from profiles where id=approver and tenant_id=t and coalesce(is_active,true)) or not user_has_branch_access(approver,r.branch_id) or not user_has_permission(approver,'pos_fnb.cancel_unpaid_order') then raise exception 'FNB_CANCEL_APPROVER_SCOPE_DENIED'; end if;
 end if;
 select coalesce(sum((quantity-coalesce(cancelled_qty,0))*(unit_price+coalesce((select sum((e->>'price')::numeric*(e->>'quantity')::numeric) from jsonb_array_elements(coalesce(toppings,'[]')) e where (e->>'quantity')::numeric>0),0))),0) into before_gross from kitchen_order_items where kitchen_order_id=k.id;
 old_discount:=least(before_gross,greatest(coalesce(k.discount_amount,0),0));
 if r.whole_bill then
   v_result:=fnb_cancel_unpaid_order_atomic(k.id,'Khác',r.reason,p_shift_id,p_otp_id);
   -- Only the event just created for this previously active bill is corrected.
   update pos_exception_events set amount=before_gross-old_discount,items_snapshot=r.items,
     metadata=metadata||jsonb_build_object('request_id',r.id,'before_gross',before_gross,'before_discount',old_discount)
   where kitchen_order_id=k.id and tenant_id=t and event_type='unpaid_order_cancel' and requested_by=a
     and metadata->>'request_id' is null;
 else
   update kitchen_order_items i set cancelled_qty=coalesce(i.cancelled_qty,0)+(e->>'quantity')::integer from jsonb_array_elements(r.items) e where i.id=(e->>'id')::uuid and i.kitchen_order_id=k.id;
   select coalesce(sum((quantity-coalesce(cancelled_qty,0))*(unit_price+coalesce((select sum((e->>'price')::numeric*(e->>'quantity')::numeric) from jsonb_array_elements(coalesce(toppings,'[]')) e where (e->>'quantity')::numeric>0),0))),0) into after_gross from kitchen_order_items where kitchen_order_id=k.id;
   new_discount:=least(after_gross,round(old_discount*after_gross/nullif(before_gross,0)));
   update kitchen_orders set discount_amount=coalesce(new_discount,0),updated_at=now() where id=k.id;
   insert into pos_exception_events(tenant_id,branch_id,shift_id,source,event_type,target_type,target_id,kitchen_order_id,amount,reason_code,reason_note,items_snapshot,metadata,requested_by,approved_by)
   values(t,r.branch_id,p_shift_id,'fnb','cancel_unpaid_item','kitchen_order',k.id,k.id,before_gross-after_gross-old_discount+coalesce(new_discount,0),'Khác',r.reason,r.items,
   jsonb_build_object('request_id',r.id,'before_gross',before_gross,'after_gross',after_gross,'before_discount',old_discount,'after_discount',new_discount,'delegated',p_otp_id is not null),a,approver);
   v_result:=jsonb_build_object('success',true,'order_id',k.id,'cancelled_items',r.items,'remaining_gross',after_gross,'discount_amount',new_discount);
 end if;
 update fnb_cancel_requests set executed_at=now(),result=v_result where id=r.id;
 return v_result;
end $$;
revoke all on function public.fnb_request_cancel_00455(uuid,jsonb,text,boolean),public.fnb_pending_cancel_requests_00455(),public.fnb_issue_cancel_otp_00455(uuid),public.fnb_execute_cancel_request_00455(uuid,uuid,uuid) from public,anon;
grant execute on function public.fnb_request_cancel_00455(uuid,jsonb,text,boolean),public.fnb_pending_cancel_requests_00455(),public.fnb_issue_cancel_otp_00455(uuid),public.fnb_execute_cancel_request_00455(uuid,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
