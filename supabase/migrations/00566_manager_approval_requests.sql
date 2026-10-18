-- No historical business data is rewritten. Requests contain the exact intent
-- approved by a manager; domain RPCs still own money, stock and their locks.
begin;
set local lock_timeout='3s';
create table public.manager_approval_requests (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 branch_id uuid, action_code text not null, target_id uuid, requested_by uuid not null,
 reason text not null, summary text not null, payload jsonb not null, context_hash text,
 status text not null default 'pending' check(status in ('pending','issued','authorized','executed','rejected')),
 otp_id uuid, authorized_at timestamptz, executed_at timestamptz,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '30 minutes',
 rejected_by uuid, rejected_at timestamptz, reject_reason text,
 check(length(reason) between 3 and 500), check(octet_length(payload::text)<=262144)
);
alter table public.manager_approval_requests enable row level security;
revoke all on public.manager_approval_requests from public,anon,authenticated;
create index manager_approval_pending_00566 on public.manager_approval_requests(tenant_id,created_at desc) where status in ('pending','issued');
create index manager_approval_otp_00566 on public.manager_approval_requests(otp_id) where otp_id is not null;

create function public._manager_approval_permission_00566(p_action text) returns text
language sql immutable set search_path=public as $$
 select case p_action when 'fnb.discount_override' then 'pos_fnb.discount'
 when 'pos_retail.discount_override' then 'pos_retail.discount'
 when 'fnb.void_paid_bill' then 'pos_fnb.void_paid_bill'
 when 'crm.delete_customer' then 'customers.delete'
 when 'crm.delete_supplier' then 'suppliers.delete'
 when 'products.delete' then 'products.delete' end
$$;

create function public._manager_approval_detail_00566(e jsonb) returns jsonb
language sql immutable set search_path=public as $$
 select jsonb_build_object('toppings',
 (select coalesce(jsonb_agg(jsonb_build_object('productId',coalesce(t->>'productId',t->>'product_id'),'quantity',(t->>'quantity')::numeric,'price',(t->>'price')::numeric) order by coalesce(t->>'productId',t->>'product_id')),'[]')
 from jsonb_array_elements(coalesce(nullif(e->'toppings','null'::jsonb),'[]')) t),
 'modifiers',
 (select coalesce(jsonb_agg(jsonb_build_object('groupId',g->>'groupId','options',
 (select coalesce(jsonb_agg(jsonb_build_object('optionId',o->>'optionId','scaleFactor',o->'scaleFactor','priceDelta',o->'priceDelta','linkedProductId',o->'linkedProductId') order by o->>'optionId'),'[]') from jsonb_array_elements(g->'options') o)) order by g->>'groupId'),'[]')
 from jsonb_array_elements(coalesce(nullif(e->'modifierSelections','null'::jsonb),nullif(e->'modifier_selections','null'::jsonb),'[]')) g))
$$;
revoke all on function public._manager_approval_detail_00566(jsonb) from public,anon,authenticated;

-- Normalize both browser line snapshots and trusted server rows. Labels, local
-- IDs and display rounding never participate in authorization comparisons.
create function public._manager_approval_items_00566(p_items jsonb,p_fnb boolean) returns jsonb
language sql immutable set search_path=public as $$
 select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from (
 select jsonb_build_object('productId',coalesce(e->>'productId',e->>'product_id'),
 'variantId',nullif(coalesce(e->>'variantId',e->>'variant_id'),''),
 'quantity',(e->>'quantity')::numeric,'unitPrice',coalesce(e->>'unitPrice',e->>'unit_price')::numeric,
 'detail',case when p_fnb then public._manager_approval_detail_00566(e)
 else jsonb_build_object('discount',coalesce((e->>'discount')::numeric,0),'unit',coalesce(e->>'unit','')) end) x
 from jsonb_array_elements(p_items) e where (e->>'quantity')::numeric>0
 ) q
$$;

create function public._manager_approval_target_00566(p_action text,p_id uuid,p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare j jsonb;
begin
 case p_action
 when 'fnb.void_paid_bill' then select to_jsonb(i) into j from invoices i where id=p_id and tenant_id=p_tenant and deleted_at is null and status='completed' and exists(select 1 from kitchen_orders k where k.invoice_id=i.id and k.tenant_id=p_tenant);
 when 'crm.delete_customer' then select to_jsonb(c) into j from customers c where id=p_id and tenant_id=p_tenant;
 when 'crm.delete_supplier' then select to_jsonb(s) into j from suppliers s where id=p_id and tenant_id=p_tenant;
 when 'products.delete' then select to_jsonb(p) into j from products p where id=p_id and tenant_id=p_tenant;
 else raise exception 'APPROVAL_ACTION_INVALID'; end case;
 if j is null then raise exception 'APPROVAL_TARGET_NOT_FOUND'; end if;
 return j;
end $$;

create function public.request_manager_approval_00566(p_action text,p_meta jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; b uuid; target uuid; j jsonb; r uuid; v_summary text; v_hash text;
 required text:=_manager_approval_permission_00566(p_action); view_perm text; items jsonb; amount numeric; subtotal numeric;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or required is null then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 if jsonb_typeof(p_meta) is distinct from 'object' or octet_length(p_meta::text)>262144 then raise exception 'APPROVAL_META_INVALID'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'APPROVAL_REASON_REQUIRED'; end if;
 view_perm:=case p_action when 'fnb.discount_override' then 'pos_fnb.send_kitchen' when 'fnb.void_paid_bill' then 'pos_fnb.view_orders'
 when 'pos_retail.discount_override' then 'pos_retail.checkout' when 'crm.delete_customer' then 'customers.view'
 when 'crm.delete_supplier' then 'suppliers.view' when 'products.delete' then 'products.view' end;
 if not coalesce(user_has_permission(a,view_perm),false) and not coalesce(user_has_permission(a,required),false) then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 target:=nullif(coalesce(p_meta->>'entity_id',p_meta->>'invoice_id',p_meta->>'kitchen_order_id'),'')::uuid;
 if p_action in ('fnb.discount_override','pos_retail.discount_override') then
  b:=nullif(p_meta->>'branch_id','')::uuid;
  if b is null or not exists(select 1 from branches where id=b and tenant_id=t) or not coalesce(user_has_branch_access(a,b),false) then raise exception 'APPROVAL_BRANCH_ACCESS_DENIED'; end if;
  if jsonb_typeof(p_meta->'items') is distinct from 'array' or jsonb_array_length(p_meta->'items') not between 1 and 500 then raise exception 'APPROVAL_ITEMS_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(p_meta->'items') e where coalesce((e->>'quantity')::numeric,0)<=0 or (e->>'quantity')::numeric in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or coalesce((e->>'unitPrice')::numeric,-1)<0 or (e->>'unitPrice')::numeric in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)) then raise exception 'APPROVAL_ITEMS_INVALID'; end if;
  items:=_manager_approval_items_00566(p_meta->'items',p_action='fnb.discount_override');
  amount:=(p_meta->>'amount')::numeric; subtotal:=(p_meta->>'subtotal')::numeric;
  if amount is null or amount<=0 or amount='NaN'::numeric or subtotal is null or subtotal='NaN'::numeric or amount>subtotal then raise exception 'APPROVAL_AMOUNT_INVALID'; end if;
  if exists(select 1 from jsonb_array_elements(items) e left join products p on p.id=(e->>'productId')::uuid and p.tenant_id=t where p.id is null or (e->>'unitPrice')::numeric<0 or (e->>'quantity')::numeric='NaN'::numeric) then raise exception 'APPROVAL_ITEMS_INVALID'; end if;
  if p_action='fnb.discount_override' and target is not null and not exists(select 1 from kitchen_orders where id=target and tenant_id=t and branch_id=b and invoice_id is null and status not in ('cancelled','completed')) then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
  if exists(select 1 from jsonb_array_elements(p_meta->'items') e left join product_variants v on v.id=nullif(e->>'variantId','')::uuid and v.product_id=(e->>'productId')::uuid and v.tenant_id=t where nullif(e->>'variantId','') is not null and v.id is null) then raise exception 'APPROVAL_ITEMS_INVALID'; end if;
  p_meta:=jsonb_set(p_meta,'{items}',(select jsonb_agg(e||jsonb_build_object('productName',p.name||case when v.id is not null then ' · '||v.name else '' end) order by ord) from jsonb_array_elements(p_meta->'items') with ordinality z(e,ord) join products p on p.id=(e->>'productId')::uuid and p.tenant_id=t left join product_variants v on v.id=nullif(e->>'variantId','')::uuid and v.product_id=p.id and v.tenant_id=t));
  p_meta:=p_meta||jsonb_build_object('canonical_items',items);
  v_summary:=left(coalesce(p_meta->>'label','Bill đang bán'),160);
  if p_action='fnb.discount_override' and target is not null then select order_number||' · '||v_summary into v_summary from kitchen_orders where id=target and tenant_id=t;
  else v_summary:=v_summary||' · '||right(coalesce(p_meta->>'bill_key',p_meta->>'draft_key','nháp'),8); end if;
 else
  j:=_manager_approval_target_00566(p_action,target,t); v_hash:=md5(j::text);
  if p_action='fnb.void_paid_bill' then
   b:=(j->>'branch_id')::uuid;
   if not coalesce(user_has_branch_access(a,b),false) then raise exception 'APPROVAL_BRANCH_ACCESS_DENIED'; end if;
  end if;
  v_summary:=left(coalesce(j->>'code','')||' · '||coalesce(j->>'name',j->>'customer_name',''),180);
  p_meta:=jsonb_build_object('entity_id',target,'code',j->>'code');
 end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||p_action,565));
 if (select count(*) from manager_approval_requests where requested_by=a and created_at>now()-interval '1 minute')>=10 then raise exception 'APPROVAL_REQUEST_RATE_LIMIT'; end if;
 -- Reopening the same intent must not flood the manager inbox.
 select id into r from manager_approval_requests where tenant_id=t and requested_by=a and action_code=p_action
 and branch_id is not distinct from b and target_id is not distinct from target and payload=p_meta and reason=trim(p_reason)
 and expires_at>now() and status in ('pending','issued') order by created_at desc limit 1;
 if r is null then
  insert into manager_approval_requests(tenant_id,branch_id,action_code,target_id,requested_by,reason,summary,payload,context_hash)
  values(t,b,p_action,target,a,trim(p_reason),v_summary,p_meta,v_hash) returning id into r;
 end if;
 return (select jsonb_build_object('id',id,'expires_at',expires_at) from manager_approval_requests where id=r);
end $$;

create function public.pending_manager_approvals_00566() returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; j jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 select coalesce(jsonb_agg(to_jsonb(q)),'[]') into j from (
 select r.id,r.action_code,r.branch_id,r.target_id,r.reason,r.summary,r.reject_reason,r.status,r.created_at,r.expires_at,
 p.full_name requested_by_name,b.name branch_name,(r.payload->>'amount')::numeric amount,(r.payload->>'subtotal')::numeric subtotal,coalesce((r.payload->>'existing_discount')::numeric,0) existing_discount,
 coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(e->>'productName',e->>'name','Món'),'quantity',e->'quantity')) from jsonb_array_elements(coalesce(r.payload->'items','[]')) e),'[]') items
 from manager_approval_requests r join profiles p on p.id=r.requested_by left join branches b on b.id=r.branch_id and b.tenant_id=t
 where r.tenant_id=t and r.status in ('pending','issued') and r.expires_at>now()
 and coalesce(user_has_permission(a,_manager_approval_permission_00566(r.action_code)),false)
 and (r.branch_id is null or coalesce(user_has_branch_access(a,r.branch_id),false)) order by r.created_at desc limit 100
 ) q;
 return j;
end $$;

do $history$
declare d text;
begin
 d:=pg_get_functiondef('public.pending_manager_approvals_00566()'::regprocedure);
 d:=replace(d,'pending_manager_approvals_00566','manager_approval_history_00566');
 d:=replace(d,'r.status in (''pending'',''issued'') and r.expires_at>now()','true');
 d:=replace(d,'r.reject_reason,r.status,r.created_at','r.reject_reason,case when r.status in (''pending'',''issued'',''authorized'') and r.expires_at<=now() then ''expired'' else r.status end as status,r.created_at');
 d:=replace(d,'limit 100','limit 30'); execute d;
end $history$;
revoke all on function public.manager_approval_history_00566() from public,anon;
grant execute on function public.manager_approval_history_00566() to authenticated;

create function public.get_manager_approval_00566(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); r record;
begin
 select r0.* into r from manager_approval_requests r0 join profiles p on p.id=a and p.tenant_id=r0.tenant_id and coalesce(p.is_active,true)
 where r0.id=p_request_id and (r0.requested_by=a or (user_has_permission(a,_manager_approval_permission_00566(r0.action_code)) and (r0.branch_id is null or user_has_branch_access(a,r0.branch_id))));
 if not found then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 return jsonb_build_object('id',r.id,'status',case when r.status in ('pending','issued','authorized') and r.expires_at<=now() then 'expired' else r.status end,'reject_reason',r.reject_reason,'expires_at',r.expires_at);
end $$;

create function public.reject_manager_approval_00566(p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); r record;
begin
 select r0.* into r from manager_approval_requests r0 join profiles p on p.id=a and p.tenant_id=r0.tenant_id and coalesce(p.is_active,true) where r0.id=p_request_id for update of r0;
 if not found or not coalesce(user_has_permission(a,_manager_approval_permission_00566(r.action_code)),false) or (r.branch_id is not null and not coalesce(user_has_branch_access(a,r.branch_id),false)) then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 if r.status not in ('pending','issued') or r.expires_at<=now() then raise exception 'APPROVAL_CHANGED'; end if;
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 then raise exception 'APPROVAL_REASON_REQUIRED'; end if;
 update manager_approval_requests set status='rejected',reject_reason=trim(p_reason),rejected_by=a,rejected_at=now() where id=r.id;
 update manager_otp_codes set expires_at=least(expires_at,now()) where id=r.otp_id and used_at is null;
 return jsonb_build_object('success',true);
end $$;

create function public.issue_manager_approval_otp_00566(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); r record; j jsonb;
begin
 select r0.* into r from manager_approval_requests r0 join profiles p on p.id=a and p.tenant_id=r0.tenant_id and coalesce(p.is_active,true) where r0.id=p_request_id for update of r0;
 if not found or not coalesce(user_has_permission(a,_manager_approval_permission_00566(r.action_code)),false) or (r.branch_id is not null and not coalesce(user_has_branch_access(a,r.branch_id),false)) then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 if r.status not in ('pending','issued') or r.expires_at<=now() then raise exception 'APPROVAL_EXPIRED_OR_CHANGED'; end if;
 if r.context_hash is not null and r.context_hash<>md5(_manager_approval_target_00566(r.action_code,r.target_id,r.tenant_id)::text) then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 update manager_otp_codes set expires_at=least(expires_at,now()) where id=r.otp_id and used_at is null;
 j:=issue_manager_otp(r.action_code,jsonb_build_object('approval_request_id',r.id,'entity_id',r.target_id,'reason',r.reason,'amount',r.payload->'amount'),r.branch_id,null::text,null::text);
 update manager_approval_requests set otp_id=(j->>'otp_id')::uuid,status='issued' where id=r.id;
 return j;
end $$;

-- Preserve the existing OTP hash/locking implementation; add scope checks
-- BEFORE consuming a code. Older cancellation requests retain their own checks.
alter function public.verify_and_use_manager_otp(text,text,jsonb) rename to _verify_and_use_manager_otp_before_00566;
revoke all on function public._verify_and_use_manager_otp_before_00566(text,text,jsonb) from public,anon,authenticated;
create function public.verify_and_use_manager_otp(p_code text,p_action_code text,p_target_meta jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; o record; j jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 select r0.* into r from manager_approval_requests r0 where r0.id=nullif(p_target_meta->>'approval_request_id','')::uuid and r0.tenant_id=t and r0.requested_by=a for update;
 if found then
  if r.action_code<>p_action_code or r.status<>'issued' or r.expires_at<=now() then raise exception 'APPROVAL_EXPIRED_OR_CHANGED'; end if;
  select * into o from manager_otp_codes where id=r.otp_id and tenant_id=t and used_at is null and expires_at>now();
  if not found or o.code_hash<>hash_manager_otp(p_code,t,o.issued_by) then raise exception 'OTP_INVALID_OR_EXPIRED'; end if;
  if not exists(select 1 from profiles where id=o.issued_by and tenant_id=t and coalesce(is_active,true)) or not user_has_permission(o.issued_by,_manager_approval_permission_00566(r.action_code)) or (r.branch_id is not null and not user_has_branch_access(o.issued_by,r.branch_id)) then raise exception 'APPROVAL_APPROVER_SCOPE_DENIED'; end if;
  j:=_verify_and_use_manager_otp_before_00566(p_code,p_action_code,p_target_meta);
  if (j->>'otp_id')::uuid<>r.otp_id then raise exception 'APPROVAL_OTP_MISMATCH'; end if;
  update manager_approval_requests set status='authorized',authorized_at=now() where id=r.id;
  return j;
 end if;
 if p_target_meta ? 'approval_request_id' then raise exception 'APPROVAL_TARGET_NOT_FOUND'; end if;
 return _verify_and_use_manager_otp_before_00566(p_code,p_action_code,p_target_meta);
end $$;

alter function public.verify_otp_authorization(uuid,text,uuid,uuid) rename to _verify_otp_authorization_before_00566;
revoke all on function public._verify_otp_authorization_before_00566(uuid,text,uuid,uuid) from public,anon,authenticated;
create function public.verify_otp_authorization(p_otp_id uuid,p_expected_action text,p_actor uuid,p_expected_target_id uuid default null) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare r record; o record;
begin
 select * into r from manager_approval_requests where otp_id=p_otp_id for update;
 if not found then return _verify_otp_authorization_before_00566(p_otp_id,p_expected_action,p_actor,p_expected_target_id); end if;
 if auth.uid() is distinct from p_actor or r.requested_by<>p_actor or r.action_code<>p_expected_action or r.status<>'authorized' then raise exception 'APPROVAL_SCOPE_DENIED'; end if;
 if r.expires_at<=now() then raise exception 'APPROVAL_EXPIRED'; end if;
 if r.target_id is distinct from p_expected_target_id then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 select * into o from manager_otp_codes where id=p_otp_id and tenant_id=r.tenant_id and used_by=p_actor and used_at is not null;
 if not found or not exists(select 1 from profiles where id=p_actor and tenant_id=r.tenant_id and coalesce(is_active,true)) or not exists(select 1 from profiles where id=o.issued_by and tenant_id=r.tenant_id and coalesce(is_active,true)) then raise exception 'APPROVAL_SCOPE_DENIED'; end if;
 if not user_has_permission(o.issued_by,_manager_approval_permission_00566(r.action_code)) or (r.branch_id is not null and (not user_has_branch_access(p_actor,r.branch_id) or not user_has_branch_access(o.issued_by,r.branch_id))) then raise exception 'APPROVAL_APPROVER_SCOPE_DENIED'; end if;
 if r.context_hash is not null and r.context_hash<>md5(_manager_approval_target_00566(r.action_code,r.target_id,r.tenant_id)::text) then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 update manager_approval_requests set status='executed',executed_at=now() where id=r.id;
 return o.issued_by;
end $$;
-- Only domain definer functions may consume a verified approval.
revoke all on function public.verify_otp_authorization(uuid,text,uuid,uuid) from public,anon,authenticated;

create function public._check_discount_approval_00566(p_otp uuid,p_action text,p_branch uuid,p_target uuid,p_amount numeric,p_items jsonb) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare r record;
begin
 select * into r from manager_approval_requests where otp_id=p_otp for update;
 -- Legacy tokens remain compatible until they naturally expire; new UI always
 -- issues request-bound tokens. They still pass the proven old OTP guards.
 if not found then return; end if;
 if r.requested_by<>auth.uid() or r.action_code<>p_action or r.branch_id<>p_branch or r.status<>'authorized' then raise exception 'APPROVAL_SCOPE_DENIED'; end if;
 if r.expires_at<=now() then raise exception 'APPROVAL_EXPIRED'; end if;
 if round((r.payload->>'amount')::numeric,2) is distinct from round(p_amount,2) then raise exception 'APPROVAL_AMOUNT_CHANGED'; end if;
 if r.payload->'canonical_items' is distinct from _manager_approval_items_00566(p_items,p_action='fnb.discount_override') then raise exception 'APPROVAL_ITEMS_CHANGED'; end if;
 if p_action='fnb.discount_override' and r.target_id is null and not exists(select 1 from kitchen_orders where id=p_target and tenant_id=r.tenant_id and idempotency_key='fnb-tab:'||(r.payload->>'draft_key')) then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 if p_action='pos_retail.discount_override' and coalesce(r.payload->>'bill_key','') is distinct from coalesce(current_setting('onebiz.approval_bill',true),'') then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 if r.target_id is not null and r.target_id is distinct from p_target then raise exception 'APPROVAL_TARGET_CHANGED'; end if;
 update manager_approval_requests set target_id=p_target where id=r.id;
end $$;

-- Guard the exact business values at the existing authoritative boundaries.
do $patch$
declare d text; old text; replacement text; p regprocedure;
begin
 p:='public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure;
 d:=pg_get_functiondef(p); old:='v_manual_discount_approver := public.verify_otp_authorization(';
 replacement:='perform public._check_discount_approval_00566(p_manual_discount_otp_id,''fnb.discount_override'',v_order.branch_id,v_order.id,v_manual_discount,(select jsonb_agg(to_jsonb(x)) from public._fnb_active_kitchen_items_00454 x where x.kitchen_order_id=v_order.id)); '||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'APPROVAL_FNB_PATCH_ANCHOR_CHANGED'; end if;
 d:=replace(d,old,replacement);
 old:='  if p_promotion_id is not null then';
 -- The first occurrence starts eligibility calculation, not usage recording.
 if position(old in d)=0 then raise exception 'APPROVAL_COMPLIMENTARY_ANCHOR_CHANGED'; end if;
 d:=overlay(d placing '  if v_manual_discount > 0 and v_manual_discount + v_order.discount_amount >= v_order_subtotal then p_promotion_id := null; v_coupon_code := null; end if; '||old from position(old in d) for length(old));
 execute d;
 p:='public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'::regprocedure;
 d:=pg_get_functiondef(p); old:='if v_has_manual_discount then';
 replacement:='if v_has_manual_discount then perform public._check_discount_approval_00566(p_discount_otp_id,''pos_retail.discount_override'',p_branch_id,null,(case when v_source=''manual'' then v_order_discount else 0 end)+(select coalesce(sum((e->>''discount'')::numeric),0) from jsonb_array_elements(v_trusted_items) e),v_trusted_items);';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'APPROVAL_RETAIL_PATCH_ANCHOR_CHANGED'; end if;
 execute replace(d,old,replacement);
 for p in select x.oid::regprocedure from pg_proc x join pg_namespace n on n.oid=x.pronamespace
 where n.nspname='public' and x.prokind='f' and x.proname<>'pos_prepare_retail_checkout'
 and pg_get_functiondef(x.oid) like '%v_prepared := public.pos_prepare_retail_checkout(%' loop
  d:=pg_get_functiondef(p);
  if d like '%p_client_session_id%' then replacement:='perform set_config(''onebiz.approval_bill'',coalesce(p_client_session_id::text,''''),true); ';
  elsif d like '%p_invoice_id%' then replacement:='perform set_config(''onebiz.approval_bill'',p_invoice_id::text,true); ';
  else continue; end if;
  execute replace(d,'v_prepared := public.pos_prepare_retail_checkout(',replacement||'v_prepared := public.pos_prepare_retail_checkout(');
 end loop;
 p:='public.checkout_internal_pos_v2(jsonb)'::regprocedure;
 d:=pg_get_functiondef(p); old:='if v_line_disc+v_order_disc>0 then perform verify_otp_authorization(';
 replacement:='if v_line_disc+v_order_disc>0 then perform set_config(''onebiz.approval_bill'',coalesce(v_draft::text,v_session::text),true); perform public._check_discount_approval_00566(nullif(p_checkout->>''discountOtpId'','''')::uuid,''pos_retail.discount_override'',v_branch,null,v_line_disc+v_order_disc,p_checkout->''items''); perform verify_otp_authorization(';
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'APPROVAL_INTERNAL_PATCH_ANCHOR_CHANGED'; end if;
 execute replace(d,old,replacement);
end $patch$;

-- Supplier delegation reuses all original FK checks and audit, with only the
-- permission subject delegated. Caller identity is never impersonated.
do $supplier$
declare d text; old text:='if not public.user_has_permission(v_actor, ''suppliers.delete'') then';
begin
 d:=pg_get_functiondef('public.delete_supplier_atomic(uuid,uuid)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'APPROVAL_SUPPLIER_PATCH_ANCHOR_CHANGED'; end if;
 d:=replace(d,'delete_supplier_atomic(p_supplier_id uuid, p_actor_id uuid DEFAULT NULL::uuid)','delete_supplier_with_approval_00566(p_supplier_id uuid, p_otp_id uuid DEFAULT NULL::uuid)');
 d:=replace(d,'if p_actor_id is not null and p_actor_id <> v_actor then','if false then');
 d:=replace(d,old,'if not public.user_has_permission(case when p_otp_id is null then v_actor else public.verify_otp_authorization(p_otp_id,''crm.delete_supplier'',v_actor,p_supplier_id) end, ''suppliers.delete'') then');
 if d not like '%FUNCTION public.delete_supplier_with_approval_00566(%' or d like '%p_actor_id%' then raise exception 'APPROVAL_SUPPLIER_SIGNATURE_CHANGED'; end if;
 execute d;
end $supplier$;


alter function public.issue_manager_otp(text,jsonb,uuid,text,text) rename to _issue_manager_otp_before_00566;
alter function public.issue_manager_otp(text,jsonb,uuid) rename to _issue_manager_otp_before_00566;
revoke all on function public._issue_manager_otp_before_00566(text,jsonb,uuid,text,text),public._issue_manager_otp_before_00566(text,jsonb,uuid) from public,anon,authenticated;
do $rate$
declare d text;
begin
 d:=pg_get_functiondef('public._issue_manager_otp_before_00566(text,jsonb,uuid,text,text)'::regprocedure);
 if position('v_recent_count >= 5' in d)=0 then raise exception 'APPROVAL_ISSUER_RATE_ANCHOR_CHANGED'; end if;
 d:=replace(d,'v_recent_count >= 5','v_recent_count >= 60');
 d:=replace(d,'5 OTP','60 OTP'); execute d;
end $rate$;
create function public.issue_manager_otp(p_action_code text,p_target_meta jsonb default '{}',p_branch_id uuid default null,p_target_invoice_code text default null,p_target_kitchen_order_number text default null) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; c record; previous_otp uuid;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null then raise exception 'APPROVAL_PERMISSION_DENIED'; end if;
 if p_target_meta ? 'approval_request_id' then
  select * into r from manager_approval_requests where id=(p_target_meta->>'approval_request_id')::uuid and tenant_id=t;
  previous_otp:=r.otp_id;
  if not found or r.action_code<>p_action_code or r.status not in ('pending','issued') or r.expires_at<=now()
   or r.branch_id is distinct from p_branch_id or r.target_id is distinct from nullif(p_target_meta->>'entity_id','')::uuid then raise exception 'APPROVAL_SCOPE_DENIED'; end if;
  if not coalesce(user_has_permission(a,_manager_approval_permission_00566(r.action_code)),false) or (r.branch_id is not null and not coalesce(user_has_branch_access(a,r.branch_id),false)) then raise exception 'APPROVAL_APPROVER_SCOPE_DENIED'; end if;
 elsif p_target_meta ? 'request_id' and p_action_code in ('fnb.cancel_unpaid_bill','fnb.cancel_unpaid_item') then
  select * into c from fnb_cancel_requests where id=(p_target_meta->>'request_id')::uuid and tenant_id=t;
  previous_otp:=c.otp_id;
  if not found or c.branch_id is distinct from p_branch_id or c.kitchen_order_id is distinct from nullif(p_target_meta->>'entity_id','')::uuid
   or c.context_hash is distinct from p_target_meta->>'context_hash' or c.expires_at<=now() or c.executed_at is not null
   or p_action_code<>(case when c.whole_bill then 'fnb.cancel_unpaid_bill' else 'fnb.cancel_unpaid_item' end)
   or not user_has_permission(a,'pos_fnb.cancel_unpaid_order') or not user_has_branch_access(a,c.branch_id) then raise exception 'APPROVAL_SCOPE_DENIED'; end if;
 else raise exception 'APPROVAL_REQUEST_REQUIRED'; end if;
 if exists(select 1 from manager_otp_codes where id=previous_otp and created_at>now()-interval '10 seconds') then raise exception 'APPROVAL_ISSUE_TOO_FAST: Đợi 10 giây trước khi cấp mã mới cho cùng yêu cầu'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text,565));
 return _issue_manager_otp_before_00566(p_action_code,p_target_meta,p_branch_id,null::text,null::text);
end $$;
create function public.issue_manager_otp(p_action_code text,p_target_meta jsonb default '{}',p_branch_id uuid default null) returns jsonb
language sql security definer set search_path=public,extensions as $$select issue_manager_otp(p_action_code,p_target_meta,p_branch_id,null::text,null::text)$$;
revoke all on function public.issue_manager_otp(text,jsonb,uuid,text,text),public.issue_manager_otp(text,jsonb,uuid) from public,anon,authenticated;

-- Helpers are private; public RPCs enforce active profile, tenant and scope.
revoke all on function public._manager_approval_permission_00566(text),public._manager_approval_items_00566(jsonb,boolean),public._manager_approval_target_00566(text,uuid,uuid),public._check_discount_approval_00566(uuid,text,uuid,uuid,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.request_manager_approval_00566(text,jsonb,text),public.pending_manager_approvals_00566(),public.get_manager_approval_00566(uuid),public.reject_manager_approval_00566(uuid,text),public.issue_manager_approval_otp_00566(uuid),public.delete_supplier_with_approval_00566(uuid,uuid),public.verify_and_use_manager_otp(text,text,jsonb) from public,anon;
grant execute on function public.request_manager_approval_00566(text,jsonb,text),public.pending_manager_approvals_00566(),public.get_manager_approval_00566(uuid),public.reject_manager_approval_00566(uuid,text),public.issue_manager_approval_otp_00566(uuid),public.delete_supplier_with_approval_00566(uuid,uuid),public.verify_and_use_manager_otp(text,text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
