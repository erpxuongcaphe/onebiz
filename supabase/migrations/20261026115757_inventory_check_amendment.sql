-- Amend a count by posting only its incremental difference. Never replay sales.
begin;
set local lock_timeout='3s';
create table public.inventory_check_changes (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 check_id uuid not null references public.inventory_checks(id),
 request_id uuid not null,
 action text not null check(action in ('edit','cancel')),
 reason text not null check(length(trim(reason)) between 3 and 1000),
 request jsonb not null,
 before_data jsonb not null,
 result jsonb not null,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,request_id)
);
create index inventory_check_changes_check_idx on public.inventory_check_changes(check_id,created_at desc);
alter table public.inventory_check_changes enable row level security;
revoke all on public.inventory_check_changes from public,anon,authenticated;

create or replace function public.get_inventory_check_change_source(p_check_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; c public.inventory_checks%rowtype; lines jsonb;
begin
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if not public.user_has_permission(actor,'inventory.view') or not (
   public.user_has_permission(actor,'inventory.edit_check') or public.user_has_permission(actor,'inventory.cancel_check'))
 then raise exception 'INSUFFICIENT_PERMISSION' using errcode='42501'; end if;
 select * into c from public.inventory_checks where id=p_check_id and tenant_id=tenant;
 if not found then raise exception 'INVENTORY_CHECK_NOT_FOUND'; end if;
 if not public.user_has_branch_access(actor,c.branch_id) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('productId',i.product_id,'name',i.product_name,'code',p.code,'unit',p.unit,
   'systemStock',i.system_stock,'actualStock',i.actual_stock) order by i.product_id,i.id),'[]') into lines
 from public.inventory_check_items i join public.products p on p.id=i.product_id and p.tenant_id=tenant where i.check_id=c.id;
 return jsonb_build_object('id',c.id,'branchId',c.branch_id,'code',c.code,'status',c.status,'note',coalesce(c.note,''),
   'items',lines,'version',md5(to_jsonb(c)::text||lines::text));
end $$;
revoke all on function public.get_inventory_check_change_source(uuid) from public,anon;
grant execute on function public.get_inventory_check_change_source(uuid) to authenticated;

create or replace function public._change_inventory_check(
 p_check_id uuid,p_action text,p_items jsonb,p_note text,p_reason text,p_source_version text,
 p_request_id uuid,p_preview_token text,p_apply boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); tenant uuid; c public.inventory_checks%rowtype; src jsonb; req jsonb; prior public.inventory_check_changes%rowtype;
 item_row record; x jsonb; lines jsonb:='[]'; state jsonb:='[]'; plan jsonb; token text; change_id uuid:=gen_random_uuid(); movement_id uuid;
 actual numeric; old_net numeric; ledger_net numeric; delta numeric; stock_qty numeric; cost_qty numeric; cost_total numeric; deficit_qty numeric;
 wac numeric; global_qty numeric; tracked boolean; cost_known boolean; show_cost boolean; blocked text; total_cost_delta numeric:=0;
begin
 if p_action not in ('edit','cancel') or p_action is null then raise exception 'INVENTORY_CHECK_ACTION_INVALID'; end if;
 select tenant_id into tenant from public.profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501'; end if;
 if not public.user_has_permission(actor,'inventory.view') or not public.user_has_permission(actor,
   case when p_action='edit' then 'inventory.edit_check' else 'inventory.cancel_check' end)
 then raise exception 'INSUFFICIENT_PERMISSION' using errcode='42501'; end if;
 select * into c from public.inventory_checks where id=p_check_id and tenant_id=tenant for update;
 if not found then raise exception 'INVENTORY_CHECK_NOT_FOUND'; end if;
 if not public.user_has_branch_access(actor,c.branch_id) then raise exception 'BRANCH_ACCESS_DENIED' using errcode='42501'; end if;
 if p_request_id is null or length(trim(coalesce(p_reason,''))) not between 3 and 1000 or length(coalesce(p_note,''))>5000
 then raise exception 'INVENTORY_CHECK_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>5000 then raise exception 'INVENTORY_CHECK_ITEMS_INVALID'; end if;
 req:=jsonb_build_object('checkId',p_check_id,'action',p_action,'items',p_items,'note',coalesce(p_note,''),'reason',trim(p_reason),'version',p_source_version);
 show_cost:=public.user_has_permission(actor,'products.view_cost');
 select * into prior from public.inventory_check_changes where tenant_id=tenant and request_id=p_request_id;
 if found then
   if prior.created_by<>actor or prior.request<>req then raise exception 'INVENTORY_CHECK_REQUEST_CONFLICT'; end if;
   plan:=prior.result;
   if not show_cost then
     select jsonb_agg(v||jsonb_build_object('costDelta',null)) into lines from jsonb_array_elements(plan->'items') v;
     plan:=plan||jsonb_build_object('items',lines,'costDelta',null,'costVisible',false);
   end if;
   return plan||jsonb_build_object('idempotent',true);
 end if;
 src:=public.get_inventory_check_change_source(p_check_id);
 if p_source_version is distinct from src->>'version' then raise exception 'INVENTORY_CHECK_SOURCE_CHANGED' using errcode='40001'; end if;
 if c.status not in ('draft','in_progress','balanced') then raise exception 'INVENTORY_CHECK_NOT_EDITABLE'; end if;
 if jsonb_array_length(src->'items')=0 or
   (select count(*) from public.inventory_check_items where check_id=c.id)<>jsonb_array_length(src->'items') or
   exists(select 1 from public.inventory_check_items where check_id=c.id group by product_id having count(*)<>1)
 then raise exception 'INVENTORY_CHECK_HISTORY_AMBIGUOUS'; end if;
 if p_action='edit' and (
   jsonb_array_length(p_items)<>jsonb_array_length(src->'items') or
   exists(select 1 from jsonb_array_elements(p_items) v group by v->>'productId' having count(*)<>1) or
   exists(select 1 from jsonb_array_elements(p_items) v where not exists(select 1 from public.inventory_check_items i where i.check_id=c.id and i.product_id::text=v->>'productId'))
 ) then raise exception 'INVENTORY_CHECK_ITEMS_INVALID'; end if;
 -- Same global product lock used by stock-changing operations. Deterministic order.
 perform p.id from public.products p join public.inventory_check_items ci on ci.product_id=p.id
   where ci.check_id=c.id and p.tenant_id=tenant order by p.id for update of p;
 tracked:=public._fnb_branch_cost_tracking_enabled_00390(tenant,c.branch_id);
 if exists(select 1 from public.stock_movements sm where sm.tenant_id=tenant and sm.reference_type='inventory_check' and sm.reference_id=c.id
   and (sm.branch_id<>c.branch_id or not exists(select 1 from public.inventory_check_items ci where ci.check_id=c.id and ci.product_id=sm.product_id)))
 then raise exception 'INVENTORY_CHECK_LEDGER_MISMATCH'; end if;
 for item_row in select ci.*,p.code,p.unit,p.stock,p.cost_price from public.inventory_check_items ci
   join public.products p on p.id=ci.product_id and p.tenant_id=tenant where ci.check_id=c.id order by p.id
 loop
   if p_action='edit' then
     select v into x from jsonb_array_elements(p_items) v where v->>'productId'=item_row.product_id::text;
     actual:=(x->>'actualStock')::numeric;
     if actual is null or actual::text in ('NaN','Infinity','-Infinity') or actual<0 or actual>999999999999
     then raise exception 'INVENTORY_CHECK_QUANTITY_INVALID'; end if;
     actual:=round(actual,4);
   else actual:=item_row.actual_stock; end if;
   old_net:=case when c.status='balanced' then round(item_row.actual_stock-item_row.system_stock,4) else 0 end;
   select coalesce(sum(case when sm.type='in' then sm.quantity when sm.type='out' then -sm.quantity else 0 end),0)
     into ledger_net from public.stock_movements sm where sm.tenant_id=tenant and sm.branch_id=c.branch_id
       and sm.product_id=item_row.product_id and sm.reference_type='inventory_check' and sm.reference_id=c.id;
   if abs(ledger_net-old_net)>0.0001 then raise exception 'INVENTORY_CHECK_LEDGER_MISMATCH'; end if;
   delta:=case when c.status<>'balanced' then 0 when p_action='cancel' then -old_net else round(actual-item_row.actual_stock,4) end;
   perform 1 from public.branch_stock bs where bs.tenant_id=tenant and bs.branch_id=c.branch_id and bs.product_id=item_row.product_id and bs.variant_id is null for update;
   select coalesce(sum(bs.quantity),0) into stock_qty from public.branch_stock bs where bs.tenant_id=tenant and bs.branch_id=c.branch_id and bs.product_id=item_row.product_id and bs.variant_id is null;
   global_qty:=coalesce(item_row.stock,0); wac:=coalesce(item_row.cost_price,0); cost_qty:=null; cost_total:=null; deficit_qty:=0; cost_known:=true; blocked:=null;
   if tracked then
     select b.unit_cost,b.costed_quantity,b.total_cost,coalesce(b.deficit_quantity,0) into wac,cost_qty,cost_total,deficit_qty from public.fnb_branch_product_cost_balances b
       where b.tenant_id=tenant and b.branch_id=c.branch_id and b.product_id=item_row.product_id for update;
     cost_known:=found and (cost_qty>0 or exists(select 1 from public.fnb_branch_product_cost_events e where e.tenant_id=tenant and e.branch_id=c.branch_id and e.product_id=item_row.product_id and e.direction='in')
       or exists(select 1 from public.fnb_branch_product_cost_balances b where b.tenant_id=tenant and b.branch_id=c.branch_id and b.product_id=item_row.product_id and b.opening_cost_confirmed));
   end if;
   if delta<0 and (stock_qty+delta<0 or global_qty+delta<0) then blocked:='INSUFFICIENT_CURRENT_STOCK';
   elsif delta<>0 and tracked and (not cost_known or abs(cost_qty-deficit_qty-stock_qty)>0.0001 or (delta<0 and cost_qty+delta<0)) then blocked:='BRANCH_COST_RECONCILIATION_REQUIRED'; end if;
   total_cost_delta:=total_cost_delta+round(delta*coalesce(wac,0),4);
   lines:=lines||jsonb_build_array(jsonb_build_object('productId',item_row.product_id,'name',item_row.product_name,'code',item_row.code,'unit',item_row.unit,
     'systemStock',item_row.system_stock,'actualBefore',item_row.actual_stock,'actualAfter',actual,'stockBefore',stock_qty,'stockDelta',delta,'stockAfter',stock_qty+delta,
     'costDelta',case when show_cost then round(delta*coalesce(wac,0),4) else null end,'blocked',blocked));
   state:=state||jsonb_build_array(jsonb_build_object('productId',item_row.product_id,'stock',stock_qty,'globalStock',global_qty,'costQty',cost_qty,'costTotal',cost_total,'deficitQty',deficit_qty,'wac',wac,'ledger',ledger_net));
 end loop;
 plan:=jsonb_build_object('checkId',c.id,'code',c.code,'action',p_action,'applied',false,'costVisible',show_cost,'items',lines,
   'costDelta',case when show_cost then total_cost_delta else null end,'canApply',not exists(select 1 from jsonb_array_elements(lines) v where v->>'blocked' is not null));
 token:=md5(jsonb_build_object('source',src,'request',req,'actor',actor,'state',state,'plan',plan)::text);
 plan:=plan||jsonb_build_object('token',token);
 if not p_apply then return plan; end if;
 if token is distinct from p_preview_token then raise exception 'INVENTORY_CHECK_PREVIEW_STALE' using errcode='40001'; end if;
 if not (plan->>'canApply')::boolean then raise exception 'INVENTORY_CHECK_CHANGE_BLOCKED'; end if;
 if p_action='edit' and coalesce(p_note,'')=coalesce(c.note,'') and not exists(select 1 from jsonb_array_elements(lines) v where v->>'actualBefore'<>v->>'actualAfter') then raise exception 'INVENTORY_CHECK_NO_CHANGE'; end if;
 insert into public.inventory_check_changes(id,tenant_id,branch_id,check_id,request_id,action,reason,request,before_data,result,created_by)
   values(change_id,tenant,c.branch_id,c.id,p_request_id,p_action,trim(p_reason),req,src,plan,actor);
 for x in select value from jsonb_array_elements(lines) loop
   delta:=(x->>'stockDelta')::numeric;
   if delta<>0 then
     insert into public.stock_movements(tenant_id,branch_id,product_id,type,quantity,reference_type,reference_id,note,created_by)
       values(tenant,c.branch_id,(x->>'productId')::uuid,case when delta>0 then 'in' else 'out' end,abs(delta),'inventory_check',c.id,
         c.code||' - '||p_action||' - '||trim(p_reason)||' ['||change_id::text||']',actor) returning id into movement_id;
     perform public.increment_product_stock((x->>'productId')::uuid,delta);
     perform public.upsert_branch_stock(tenant,c.branch_id,(x->>'productId')::uuid,delta);
     perform public._reconcile_product_lots_to_branch_00284(tenant,c.branch_id,(x->>'productId')::uuid,'inventory_check',c.id,actor,p_reason);
   end if;
   if p_action='edit' then update public.inventory_check_items set actual_stock=(x->>'actualAfter')::numeric where check_id=c.id and product_id=(x->>'productId')::uuid; end if;
 end loop;
 update public.inventory_checks set note=case when p_action='edit' then coalesce(p_note,'') else note end,
   status=case when p_action='cancel' then 'cancelled' else status end,updated_at=clock_timestamp() where id=c.id;
 plan:=plan||jsonb_build_object('applied',true,'changeId',change_id,'status',case when p_action='cancel' then 'cancelled' else c.status end);
 update public.inventory_check_changes set result=plan where id=change_id;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
   values(tenant,actor,case when p_action='cancel' then 'cancel' else 'update' end,'inventory_check',c.id,src,
     jsonb_build_object('changeId',change_id,'reason',trim(p_reason),'action',p_action,'note',p_note,'items',lines));
 return plan;
end $$;
revoke all on function public._change_inventory_check(uuid,text,jsonb,text,text,text,uuid,text,boolean) from public,anon,authenticated,service_role;

create or replace function public.preview_inventory_check_change(p_check_id uuid,p_action text,p_items jsonb,p_note text,p_reason text,p_source_version text,p_request_id uuid)
returns jsonb language sql security definer set search_path='' as $$
 select public._change_inventory_check(p_check_id,p_action,p_items,p_note,p_reason,p_source_version,p_request_id,null,false)
$$;
create or replace function public.apply_inventory_check_change(p_check_id uuid,p_action text,p_items jsonb,p_note text,p_reason text,p_source_version text,p_request_id uuid,p_preview_token text)
returns jsonb language sql security definer set search_path='' as $$
 select public._change_inventory_check(p_check_id,p_action,p_items,p_note,p_reason,p_source_version,p_request_id,p_preview_token,true)
$$;
revoke all on function public.preview_inventory_check_change(uuid,text,jsonb,text,text,text,uuid) from public,anon;
revoke all on function public.apply_inventory_check_change(uuid,text,jsonb,text,text,text,uuid,text) from public,anon;
grant execute on function public.preview_inventory_check_change(uuid,text,jsonb,text,text,text,uuid) to authenticated;
grant execute on function public.apply_inventory_check_change(uuid,text,jsonb,text,text,text,uuid,text) to authenticated;

-- Harden the legacy route too; existing callers cannot bypass the new permission.
do $patch$ declare d text; begin
 d:=replace(pg_get_functiondef('public.cancel_inventory_check_atomic(uuid)'::regprocedure),E'\r\n',E'\n');
 if strpos(d,'''inventory.check''')=0 then raise exception 'INVENTORY_CANCEL_PATCH_MISMATCH'; end if;
 execute replace(d,'''inventory.check''','''inventory.cancel_check''');
end $patch$;
-- Stocktake writes are atomic RPC-only; raw PATCH/DELETE must not skip stock,
-- cost, lot reconciliation, permission checks or immutable history.
revoke insert,update,delete,truncate,references,trigger on public.inventory_checks,public.inventory_check_items from public,authenticated,anon;
notify pgrst,'reload schema';
commit;
