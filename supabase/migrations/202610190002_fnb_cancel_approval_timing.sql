-- Approval metadata only. Preserve bill, stock, cash and existing authorization checks.
begin;
set local lock_timeout='3s';
alter table public.fnb_cancel_requests alter column expires_at set default now()+interval '10 minutes';
alter table public.fnb_cancel_requests add column if not exists superseded_at timestamptz;

create or replace function public._fnb_cancel_status_20261019(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public,extensions as $$
 select jsonb_build_object('id',r.id,'order_id',r.kitchen_order_id,'branch_id',r.branch_id,
 'whole_bill',r.whole_bill,'items',r.items,'created_at',r.created_at,'expires_at',r.expires_at,
 'server_now',now(),'otp_issued_at',o.created_at,'otp_expires_at',o.expires_at,'rejection_reason',r.rejection_reason,
 'status',case when r.executed_at is not null then 'executed'
 when r.rejected_at is not null then 'rejected' when r.superseded_at is not null then 'superseded'
 when k.invoice_id is not null or k.merged_into_id is not null or k.status not in ('pending','preparing','ready','served')
 or r.context_hash is distinct from _fnb_cancel_context_00455(k.id) then 'changed'
 when o.id is not null and (o.expires_at<=now() or o.used_at is not null) then 'otp_expired'
 when r.expires_at<=now() then 'request_expired'
 when o.id is not null then 'issued' else 'pending' end)
 from fnb_cancel_requests r join kitchen_orders k on k.id=r.kitchen_order_id
 left join manager_otp_codes o on o.id=r.otp_id and o.tenant_id=r.tenant_id and o.branch_id=r.branch_id
 where r.id=p_request_id
$$;
revoke all on function public._fnb_cancel_status_20261019(uuid) from public,anon,authenticated;

create or replace function public.fnb_cancel_status_20261019(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t;
 if not found or not coalesce(user_has_branch_access(a,r.branch_id),false)
 or not (r.requested_by=a or user_has_permission(a,'pos_fnb.cancel_unpaid_order')) then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 return _fnb_cancel_status_20261019(r.id);
end $$;

-- Keep existing request canonicalization, permissions and last-item behavior.
do $patch$
declare definition text; anchor text;
begin
 definition:=replace(pg_get_functiondef('public.fnb_request_cancel_00455(uuid,jsonb,text,boolean)'::regprocedure),E'\r\n',E'\n');
 if position('superseded_at' in definition)=0 then
  anchor:=$old$update fnb_cancel_requests set expires_at=least(expires_at,now())
 where tenant_id=t and kitchen_order_id=k.id and requested_by=a
 and executed_at is null and rejected_at is null and expires_at>now()$old$;
  anchor:=replace(anchor,E'\r\n',E'\n');
  if position(anchor in definition)=0 then raise exception 'CANCEL_TIMING_REQUEST_PATCH_CHANGED'; end if;
  definition:=replace(definition,anchor,$new$update fnb_cancel_requests set expires_at=least(expires_at,now()),superseded_at=coalesce(superseded_at,now())
 where tenant_id=t and kitchen_order_id=k.id and requested_by=a
 and executed_at is null and rejected_at is null$new$);
  execute definition;
 end if;
 definition:=replace(pg_get_functiondef('public.fnb_issue_cancel_otp_00455(uuid)'::regprocedure),E'\r\n',E'\n');
 if position('FNB_CANCEL_OTP_STILL_ACTIVE' in definition)=0 then
  anchor:=' v_issued:=issue_manager_otp';
  if position(anchor in definition)=0 then raise exception 'CANCEL_TIMING_ISSUE_PATCH_CHANGED'; end if;
  definition:=replace(definition,anchor,$guard$
 if exists(select 1 from manager_otp_codes where id=r.otp_id and used_at is null and expires_at>now()) then
  raise exception 'FNB_CANCEL_OTP_STILL_ACTIVE';
 end if;
$guard$||anchor);
  anchor:='update fnb_cancel_requests set otp_id=(v_issued->>''otp_id'')::uuid where id=r.id;';
  if position(anchor in definition)=0 then raise exception 'CANCEL_TIMING_ISSUED_EXPIRY_CHANGED'; end if;
  definition:=replace(definition,anchor,'update fnb_cancel_requests set otp_id=(v_issued->>''otp_id'')::uuid,expires_at=(v_issued->>''expires_at'')::timestamptz where id=r.id;');
  execute definition;
 end if;
 definition:=replace(pg_get_functiondef('public.fnb_pending_cancel_requests_00455()'::regprocedure),E'\r\n',E'\n');
 if position('approval' in definition)=0 then
  anchor:='r.created_at,r.expires_at,';
  if position(anchor in definition)=0 then raise exception 'CANCEL_TIMING_INBOX_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,anchor||'_fnb_cancel_status_20261019(r.id) approval,');
  anchor:='and r.expires_at>now()';
  if position(anchor in definition)=0 then raise exception 'CANCEL_TIMING_INBOX_FILTER_CHANGED'; end if;
  definition:=replace(definition,anchor,'and r.superseded_at is null and (r.expires_at>now() or r.expires_at>now()-interval ''10 minutes'')');
  execute definition;
 end if;
end $patch$;

create or replace function public.fnb_request_cancel_20261019(p_order_id uuid,p_items jsonb,p_reason text,p_whole_bill boolean default false)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare j jsonb;
begin
 j:=fnb_request_cancel_00455(p_order_id,p_items,p_reason,p_whole_bill);
 return fnb_cancel_status_20261019((j->>'id')::uuid);
end $$;

create or replace function public.fnb_renew_cancel_20261019(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; k record; j jsonb; v_current uuid;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t and requested_by=a;
 if not found or not coalesce(user_has_branch_access(a,r.branch_id),false) then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 select * into k from kitchen_orders where id=r.kitchen_order_id and tenant_id=t for update;
 select * into r from fnb_cancel_requests where id=p_request_id for update;
 j:=_fnb_cancel_status_20261019(r.id);
 if j->>'status'='executed' then return j; end if;
 if j->>'status'='superseded' then
  select id into v_current from fnb_cancel_requests where tenant_id=t and kitchen_order_id=k.id and requested_by=a
  and executed_at is null and rejected_at is null and superseded_at is null and expires_at>now()
  and context_hash=r.context_hash and items=r.items and whole_bill=r.whole_bill and reason=r.reason limit 1;
  if v_current is not null then return _fnb_cancel_status_20261019(v_current); end if;
 end if;
 if j->>'status' in ('changed','superseded') then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 if r.rejected_at is not null then raise exception 'FNB_CANCEL_REQUEST_REJECTED: %',r.rejection_reason; end if;
 if j->>'status' not in ('request_expired','otp_expired') then return j; end if;
 update fnb_cancel_requests set expires_at=least(expires_at,now()) where id=r.id;
 return fnb_request_cancel_20261019(k.id,r.items,r.reason,r.whole_bill);
end $$;

-- Transition outstanding approval metadata to the new deadlines once, without
-- extending expired requests or resetting clocks on a repeated migration.
update fnb_cancel_requests r set expires_at=least(r.expires_at,r.created_at+interval '10 minutes')
where r.otp_id is null and r.executed_at is null and r.rejected_at is null and r.expires_at>now();
update fnb_cancel_requests r set expires_at=o.expires_at
from manager_otp_codes o where o.id=r.otp_id and o.tenant_id=r.tenant_id
and r.executed_at is null and r.rejected_at is null and r.superseded_at is null
and r.expires_at>now() and o.expires_at>now() and o.used_at is null;

revoke all on function public.fnb_cancel_status_20261019(uuid),public.fnb_request_cancel_20261019(uuid,jsonb,text,boolean),public.fnb_renew_cancel_20261019(uuid) from public,anon;
grant execute on function public.fnb_cancel_status_20261019(uuid),public.fnb_request_cancel_20261019(uuid,jsonb,text,boolean),public.fnb_renew_cancel_20261019(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
