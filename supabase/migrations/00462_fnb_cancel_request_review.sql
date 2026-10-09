-- Approval metadata only: existing bills, money and stock are untouched.
begin;
set local lock_timeout='3s';
alter table public.fnb_cancel_requests add column if not exists rejected_at timestamptz;
alter table public.fnb_cancel_requests add column if not exists rejected_by uuid references public.profiles(id);
alter table public.fnb_cancel_requests add column if not exists rejection_reason text;

create or replace function public.fnb_reject_cancel_request_00462(p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; r record; k record;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'pos_fnb.cancel_unpaid_order') then raise exception 'PERMISSION_DENIED'; end if;
 select * into r from fnb_cancel_requests where id=p_request_id and tenant_id=t;
 if not found then raise exception 'CANCEL_REQUEST_NOT_FOUND'; end if;
 -- Lock order first, same order as issue/execute, to serialize payment and approval.
 select * into k from kitchen_orders where id=r.kitchen_order_id and tenant_id=t for update;
 select * into r from fnb_cancel_requests where id=p_request_id for update;
 if not user_has_branch_access(a,r.branch_id) then raise exception 'PERMISSION_DENIED'; end if;
 if r.executed_at is not null or r.expires_at<=now() or k.invoice_id is not null
 or k.status not in ('pending','preparing','ready','served') or r.context_hash<>_fnb_cancel_context_00455(k.id) then raise exception 'FNB_CANCEL_ORDER_CHANGED'; end if;
 if r.rejected_at is not null then return jsonb_build_object('success',true,'request_id',r.id); end if;
 if length(trim(coalesce(p_reason,'')))<3 or length(p_reason)>500 then raise exception 'REJECTION_REASON_REQUIRED'; end if;
 update fnb_cancel_requests set rejected_at=now(),rejected_by=a,rejection_reason=trim(p_reason) where id=r.id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(t,a,'fnb_cancel_request_reject','kitchen_order',k.id,jsonb_build_object('request_id',r.id,'branch_id',r.branch_id,'reason',trim(p_reason),'requested_by',r.requested_by,'items',r.items));
 return jsonb_build_object('success',true,'request_id',r.id);
end $$;

do $patch$
declare target regprocedure; definition text; anchor text;
begin
 foreach target in array array['public.fnb_issue_cancel_otp_00455(uuid)'::regprocedure,'public.fnb_execute_cancel_request_00455(uuid,uuid,uuid)'::regprocedure] loop
  definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  anchor:=' if r.executed_at is not null';
  if position('FNB_CANCEL_REQUEST_REJECTED' in definition)=0 then
   if position(anchor in definition)=0 then raise exception 'CANCEL_REVIEW_GUARD_CHANGED'; end if;
   execute replace(definition,anchor,' if r.rejected_at is not null then raise exception ''FNB_CANCEL_REQUEST_REJECTED: %'',r.rejection_reason; end if;'||E'\n'||anchor);
  end if;
 end loop;
 target:='public.fnb_pending_cancel_requests_00455()'::regprocedure;
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('cancel_net_amount' in definition)=0 then
  anchor:='r.created_at,r.expires_at,p.full_name';
  if position(anchor in definition)=0 then raise exception 'CANCEL_REVIEW_FIELDS_CHANGED'; end if;
  definition:=replace(definition,anchor,
   'r.created_at,r.expires_at,g.gross before_gross,'||
   '(case when r.whole_bill then g.gross-least(g.gross,greatest(coalesce(k.discount_amount,0),0)) else '||
   's.gross-least(g.gross,greatest(coalesce(k.discount_amount,0),0))+least(greatest(g.gross-s.gross,0),round(least(g.gross,greatest(coalesce(k.discount_amount,0),0))*greatest(g.gross-s.gross,0)/nullif(g.gross,0))) end) cancel_net_amount,p.full_name');
  anchor:=' where r.tenant_id=t and r.executed_at is null';
  if position(anchor in definition)=0 then raise exception 'CANCEL_REVIEW_QUERY_CHANGED'; end if;
  definition:=replace(definition,anchor,
   ' cross join lateral (select coalesce(sum((i.quantity-coalesce(i.cancelled_qty,0))*(i.unit_price+coalesce((select sum((v->>''price'')::numeric*(v->>''quantity'')::numeric) from jsonb_array_elements(coalesce(i.toppings,''[]'')) v where (v->>''quantity'')::numeric>0),0))),0) gross from kitchen_order_items i where i.kitchen_order_id=k.id) g'||E'\n'||
   ' cross join lateral (select coalesce(sum((v->>''quantity'')::numeric*((v->>''unit_price'')::numeric+coalesce((select sum((z->>''price'')::numeric*(z->>''quantity'')::numeric) from jsonb_array_elements(coalesce(v->''toppings'',''[]'')) z where (z->>''quantity'')::numeric>0),0))),0) gross from jsonb_array_elements(r.items) v) s'||E'\n'||anchor||' and r.rejected_at is null');
  execute definition;
 end if;
end $patch$;
revoke all on function public.fnb_reject_cancel_request_00462(uuid,text) from public,anon;
grant execute on function public.fnb_reject_cancel_request_00462(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
