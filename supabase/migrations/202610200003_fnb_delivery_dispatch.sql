begin;
set local lock_timeout='3s';
alter table public.kitchen_orders add column if not exists delivery_address text;
alter table public.kitchen_orders add column if not exists delivery_phone text;
alter table public.kitchen_orders add column if not exists delivery_recipient text;

create function public.fnb_delivery_dispatch_20261020(p_branch_id uuid,p_day date,p_state text default 'all',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; can_manage boolean; result jsonb;
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not exists(select 1 from branches where id=p_branch_id and tenant_id=tenant)
  or not coalesce(user_has_branch_access(actor,p_branch_id),false) then raise exception 'DELIVERY_DISPATCH_DENIED' using errcode='42501'; end if;
 can_manage:=coalesce(user_has_permission(actor,'pos_fnb.send_kitchen'),false);
 if p_day is null or p_state not in ('all','unassigned','assigned','completed') or p_state is null or p_offset<0 or p_offset>100000 or p_offset is null then raise exception 'DELIVERY_DISPATCH_FILTER_INVALID'; end if;
 with orders as (
  select k.id,k.order_number,k.invoice_id,k.delivery_fee,k.delivery_staff_id,
   coalesce(k.delivery_recipient,k.customer_name,c.name,'Khách lẻ') recipient,
   coalesce(k.delivery_address,c.address,'') address,coalesce(k.delivery_phone,c.phone,'') phone,
   sp.full_name staff_name,k.delivery_assigned_at,k.delivery_completed_at,k.created_at,k.note,
   count(*) over() total_count
  from kitchen_orders k left join customers c on c.id=k.customer_id and c.tenant_id=tenant
  left join profiles sp on sp.id=k.delivery_staff_id and sp.tenant_id=tenant
  where k.tenant_id=tenant and k.branch_id=p_branch_id and k.order_type='delivery' and coalesce(k.delivery_platform,'direct')='direct' and k.status<>'cancelled'
   and k.created_at>=p_day::timestamp at time zone 'Asia/Ho_Chi_Minh' and k.created_at<(p_day+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
   and (can_manage or k.delivery_staff_id=actor)
   and (p_state='all' or (p_state='unassigned' and k.delivery_staff_id is null and k.delivery_completed_at is null)
    or (p_state='assigned' and k.delivery_staff_id is not null and k.delivery_completed_at is null)
    or (p_state='completed' and k.delivery_completed_at is not null))
  order by k.created_at desc,k.id limit 20 offset p_offset
 ) select coalesce(jsonb_agg(to_jsonb(orders)),'[]') into result from orders;
 return result;
end $$;

create function public.fnb_delivery_destination_20261020(p_order_id uuid,p_address text,p_phone text,p_recipient text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; ko record;
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not coalesce(user_has_permission(actor,'pos_fnb.send_kitchen'),false) then raise exception 'DELIVERY_DISPATCH_DENIED' using errcode='42501'; end if;
 select * into ko from kitchen_orders where id=p_order_id and tenant_id=tenant for update;
 if not found or not coalesce(user_has_branch_access(actor,ko.branch_id),false) then raise exception 'DELIVERY_DISPATCH_DENIED' using errcode='42501'; end if;
 if ko.order_type<>'delivery' or coalesce(ko.delivery_platform,'direct')<>'direct' or ko.status='cancelled' or ko.delivery_completed_at is not null then raise exception 'DELIVERY_ORDER_NOT_EDITABLE'; end if;
 if coalesce(length(trim(p_address)),0) not between 1 and 1000 or coalesce(length(trim(p_recipient)),0) not between 1 and 120 or coalesce(length(p_phone),0)>40 then raise exception 'DELIVERY_DESTINATION_INVALID'; end if;
 update kitchen_orders set delivery_address=trim(p_address),delivery_phone=trim(coalesce(p_phone,'')),delivery_recipient=trim(p_recipient),updated_at=now() where id=ko.id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(tenant,actor,'fnb_delivery_destination_updated','kitchen_order',ko.id,
  jsonb_build_object('address',ko.delivery_address,'phone',ko.delivery_phone,'recipient',ko.delivery_recipient),
  jsonb_build_object('address',trim(p_address),'phone',trim(coalesce(p_phone,'')),'recipient',trim(p_recipient)));
 return jsonb_build_object('success',true);
end $$;

-- Preserve existing actor/tenant/branch/staff checks and audit. Harden only
-- delivery lifecycle, reassignment timestamps and duplicate completion.
do $patch$
declare d text; anchor text;
begin
 d:=replace(pg_get_functiondef('public.assign_delivery_staff_to_order(uuid,uuid)'::regprocedure),E'\r\n',E'\n');
 if position('DELIVERY_ORDER_NOT_EDITABLE' in d)=0 then
  anchor:='ko.invoice_id, ko.delivery_staff_id';
  if position(anchor in d)=0 then raise exception 'DELIVERY_ASSIGN_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,anchor||', ko.order_type, ko.delivery_platform, ko.status, ko.delivery_completed_at, ko.customer_id, ko.customer_name');
  anchor:='  if p_staff_id is not null and not exists (';
  if position(anchor in d)=0 then raise exception 'DELIVERY_ASSIGN_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,'  if v_order.order_type<>''delivery'' or coalesce(v_order.delivery_platform,''direct'')<>''direct'' or v_order.status=''cancelled'' or v_order.delivery_completed_at is not null then raise exception ''DELIVERY_ORDER_NOT_EDITABLE''; end if;'||E'\n'||anchor);
  anchor:='else coalesce(delivery_assigned_at, now())';
  if position(anchor in d)=0 then raise exception 'DELIVERY_ASSIGN_TIME_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,'else case when v_order.delivery_staff_id is distinct from p_staff_id then now() else coalesce(delivery_assigned_at,now()) end');
  anchor:='set delivery_staff_id = p_staff_id,';
  if position(anchor in d)=0 then raise exception 'DELIVERY_ASSIGN_DESTINATION_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,anchor||E'\n'||'         delivery_address=coalesce(delivery_address,(select address from customers where id=v_order.customer_id and tenant_id=v_tenant_id)), delivery_phone=coalesce(delivery_phone,(select phone from customers where id=v_order.customer_id and tenant_id=v_tenant_id)), delivery_recipient=coalesce(delivery_recipient,v_order.customer_name,(select name from customers where id=v_order.customer_id and tenant_id=v_tenant_id)),');
  execute d;
 end if;
 d:=replace(pg_get_functiondef('public.complete_delivery_for_order(uuid)'::regprocedure),E'\r\n',E'\n');
 if position('DELIVERY_ORDER_NOT_COMPLETABLE' in d)=0 then
  anchor:='ko.delivery_completed_at';
  if position(anchor in d)=0 then raise exception 'DELIVERY_COMPLETE_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,anchor||', ko.order_type, ko.delivery_platform, ko.status, ko.customer_id, ko.customer_name, ko.delivery_address, ko.delivery_phone, ko.delivery_recipient');
  anchor:='  if v_order.delivery_staff_id is null then';
  if position(anchor in d)=0 then raise exception 'DELIVERY_COMPLETE_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,'  if v_order.order_type<>''delivery'' or coalesce(v_order.delivery_platform,''direct'')<>''direct'' or v_order.status=''cancelled'' then raise exception ''DELIVERY_ORDER_NOT_COMPLETABLE''; end if;'||E'\n'||anchor);
  anchor:='    v_completed_at := v_order.delivery_completed_at;';
  if position(anchor in d)=0 then raise exception 'DELIVERY_COMPLETE_REPLAY_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,anchor||E'\n'||'    return jsonb_build_object(''kitchen_order_id'',p_kitchen_order_id,''completed_at'',v_completed_at,''duration_seconds'',extract(epoch from(v_completed_at-coalesce(v_order.delivery_assigned_at,v_order.created_at)))::int);');
  anchor:='set delivery_completed_at = v_completed_at,';
  if position(anchor in d)=0 then raise exception 'DELIVERY_COMPLETE_DESTINATION_SOURCE_CHANGED'; end if;
  d:=replace(d,anchor,anchor||E'\n'||'             delivery_address=coalesce(delivery_address,(select address from customers where id=v_order.customer_id and tenant_id=v_tenant_id)), delivery_phone=coalesce(delivery_phone,(select phone from customers where id=v_order.customer_id and tenant_id=v_tenant_id)), delivery_recipient=coalesce(delivery_recipient,v_order.customer_name,(select name from customers where id=v_order.customer_id and tenant_id=v_tenant_id)),');
  execute d;
 end if;
end $patch$;
revoke all on function public.fnb_delivery_dispatch_20261020(uuid,date,text,integer),public.fnb_delivery_destination_20261020(uuid,text,text,text) from public,anon;
grant execute on function public.fnb_delivery_dispatch_20261020(uuid,date,text,integer),public.fnb_delivery_destination_20261020(uuid,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
