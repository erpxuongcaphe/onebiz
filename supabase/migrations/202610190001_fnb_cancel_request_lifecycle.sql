-- Reopen the same cancellation request; consume OTP and cancel in one transaction.
-- No existing bills, stock, money, or unrelated approval flows are changed.
begin;
set local lock_timeout='3s';
do $patch$
declare definition text; anchor text;
begin
 definition:=replace(pg_get_functiondef('public.fnb_request_cancel_00455(uuid,jsonb,text,boolean)'::regprocedure),E'\r\n',E'\n');
 if position('v_reusable' in definition)=0 then
  anchor:='remaining numeric;';
  if position(anchor in definition)=0 then raise exception 'CANCEL_REQUEST_DECLARATION_CHANGED'; end if;
  definition:=replace(definition,anchor,'remaining numeric; v_reusable uuid; v_context text;');
  anchor:='if not p_whole_bill and selected>=remaining then raise exception ''USE_WHOLE_BILL_CANCEL''; end if;';
  if position(anchor in definition)=0 then raise exception 'CANCEL_REQUEST_LAST_ITEM_GUARD_CHANGED'; end if;
  definition:=replace(definition,anchor,'if not p_whole_bill and selected>=remaining then p_whole_bill:=true; end if;');
  anchor:=' insert into fnb_cancel_requests(tenant_id,branch_id,kitchen_order_id,requested_by,reason,items,context_hash,whole_bill)';
  if position(anchor in definition)=0 then raise exception 'CANCEL_REQUEST_INSERT_CHANGED'; end if;
  definition:=replace(definition,anchor,$reuse$
 -- The kitchen-order lock above serializes simultaneous sends/reopens.
 v_context:=_fnb_cancel_context_00455(k.id);
 select id into v_reusable from fnb_cancel_requests
 where tenant_id=t and branch_id=k.branch_id and kitchen_order_id=k.id and requested_by=a
 and executed_at is null and rejected_at is null and expires_at>now()
 and context_hash=v_context and items=canonical and whole_bill=p_whole_bill and reason=trim(p_reason)
 order by created_at desc,id desc limit 1 for update;
 -- Retain history, but make earlier/superseded requests non-actionable.
 update fnb_cancel_requests set expires_at=least(expires_at,now())
 where tenant_id=t and kitchen_order_id=k.id and requested_by=a
 and executed_at is null and rejected_at is null and expires_at>now()
 and (v_reusable is null or id<>v_reusable);
 if v_reusable is not null then
  return jsonb_build_object('id',v_reusable,'order_id',k.id,'branch_id',k.branch_id,'items',canonical,'whole_bill',p_whole_bill);
 end if;
$reuse$||anchor);
  execute definition;
 end if;
end $patch$;

create or replace function public.fnb_verify_execute_cancel_20261019(
 p_request_id uuid,p_code text,p_shift_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; k record; o record; v_verified jsonb; v_result jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null then raise exception 'ACTIVE_PROFILE_REQUIRED'; end if;
 if p_code is null or p_code !~ '^[0-9]{6}$' then raise exception 'FNB_CANCEL_OTP_INVALID'; end if;
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t and requested_by=a;
 if not found then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 -- Same lock order as request/issue/execute: order, then request, then OTP.
 select * into k from kitchen_orders where id=r.kitchen_order_id and tenant_id=t for update;
 if not found or not coalesce(user_has_branch_access(a,r.branch_id),false) then raise exception 'FNB_CANCEL_BRANCH_ACCESS_DENIED'; end if;
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t and requested_by=a for update;
 select o0.*,p.full_name issuer_name into o from manager_otp_codes o0 join profiles p on p.id=o0.issued_by
 where o0.id=r.otp_id and o0.tenant_id=t and o0.branch_id=r.branch_id
 and o0.action_code=case when r.whole_bill then 'fnb.cancel_unpaid_bill' else 'fnb.cancel_unpaid_item' end
 and o0.target_meta->>'request_id'=r.id::text and o0.target_meta->>'context_hash'=r.context_hash
 and o0.code_hash=hash_manager_otp(p_code,t,o0.issued_by) for update of o0;
 if not found then raise exception 'FNB_CANCEL_OTP_INVALID'; end if;
 -- A lost HTTP response can be retried without a second physical cancellation.
 if r.executed_at is not null and o.used_at is not null and o.used_by=a then
  v_verified:=jsonb_build_object('success',true,'otp_id',o.id,'action_code',o.action_code,'issued_by',o.issued_by,'issued_by_name',o.issuer_name,'issued_at',o.created_at,'used_at',o.used_at);
  return jsonb_build_object('verification',v_verified,'result',r.result);
 end if;
 if r.rejected_at is not null then raise exception 'FNB_CANCEL_REQUEST_REJECTED: %',r.rejection_reason; end if;
 if r.expires_at<=now() or k.invoice_id is not null or k.status not in ('pending','preparing','ready','served')
 or r.context_hash<>_fnb_cancel_context_00455(k.id) then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 if o.used_at is not null or o.expires_at<=now() then raise exception 'FNB_CANCEL_OTP_INVALID'; end if;
 v_verified:=verify_and_use_manager_otp(p_code,o.action_code,jsonb_build_object('entity_id',k.id,'kitchen_order_id',k.id,'request_id',r.id,'reason',r.reason));
 if (v_verified->>'otp_id')::uuid is distinct from o.id then raise exception 'FNB_CANCEL_OTP_SCOPE_REQUIRED'; end if;
 v_result:=fnb_execute_cancel_request_00455(r.id,o.id,p_shift_id);
 if v_result->>'success' is distinct from 'true' then raise exception 'FNB_CANCEL_EXECUTION_FAILED'; end if;
 return jsonb_build_object('verification',v_verified,'result',v_result);
end $$;
revoke all on function public.fnb_verify_execute_cancel_20261019(uuid,text,uuid) from public,anon;
grant execute on function public.fnb_verify_execute_cancel_20261019(uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
