-- New paid F&B invoices freeze service context; existing invoices are never backfilled.
begin;
alter table public.invoices add column if not exists fnb_context jsonb;
create or replace function public._fnb_paid_context_20261023(p_order uuid,p_note text default null)
returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('version',1,'order_id',k.id,'order_number',k.order_number,
   'order_type',k.order_type,
   'opened_at',case when k.created_at<=coalesce(nullif(current_setting('onebiz.fnb_paid_occurred_at',true),'')::timestamptz,transaction_timestamp()) then k.created_at end,
   'paid_at',coalesce(nullif(current_setting('onebiz.fnb_paid_occurred_at',true),'')::timestamptz,transaction_timestamp()),
   'paid_time_source',case when nullif(current_setting('onebiz.fnb_paid_occurred_at',true),'') is null then 'system' else 'offline' end,
   'table_number',t.table_number,'table_name',t.name,
   'area_name',coalesce(nullif(z.name,''),nullif(t.zone,'')),'pos_note',coalesce(p_note,k.note))
 from kitchen_orders k
 left join restaurant_tables t on t.id=k.table_id and t.tenant_id=k.tenant_id and t.branch_id=k.branch_id
 left join floor_plan_zones z on z.id=t.zone_id and z.tenant_id=k.tenant_id and z.branch_id=k.branch_id
 where k.id=p_order;
$$;
revoke all on function public._fnb_paid_context_20261023(uuid,text) from public,anon,authenticated;
-- A later table rename, note edit, void or retry must not rewrite the paid snapshot.
create or replace function public._keep_fnb_paid_context_20261023()
returns trigger language plpgsql set search_path=public as $$
begin
 if old.fnb_context is not null and new.fnb_context is distinct from old.fnb_context then
   raise exception 'FNB_PAID_CONTEXT_IMMUTABLE' using errcode='22023';
 end if;
 return new;
end $$;
revoke all on function public._keep_fnb_paid_context_20261023() from public,anon,authenticated;
drop trigger if exists keep_fnb_paid_context_20261023 on public.invoices;
create trigger keep_fnb_paid_context_20261023 before update of fnb_context on public.invoices
 for each row execute function public._keep_fnb_paid_context_20261023();
do $patch$
declare d text; old_fragment text; new_fragment text;
begin
 d:=pg_get_functiondef('public._fnb_complete_payment_impl_00230(uuid,uuid,text,text,jsonb,numeric,numeric,text,uuid,uuid,numeric)'::regprocedure);
 if position('_fnb_paid_context_20261023' in d)=0 then
  old_fragment:='payment_method, source, note, created_by, shift_id, tip_amount';
  if position(old_fragment in d)=0 then raise exception 'FNB_CONTEXT_INSERT_COLUMNS_CHANGED';end if;
  d:=replace(d,old_fragment,old_fragment||', fnb_context');
  old_fragment:='v_payment_method_effective, ''fnb'', v_note, p_created_by, p_shift_id, v_tip';
  if position(old_fragment in d)=0 then raise exception 'FNB_CONTEXT_INSERT_VALUES_CHANGED';end if;
  d:=replace(d,old_fragment,old_fragment||', public._fnb_paid_context_20261023(p_kitchen_order_id,p_note)');
  execute d;
 end if;
 d:=pg_get_functiondef('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure);
 if position('FNB_ZERO_TOTAL_ACTIVE_ITEMS_20261023' in d)=0 then
  old_fragment:='if v_menu_subtotal <= 0 or v_order_subtotal <= 0 then';
  new_fragment:=$guard$-- FNB_ZERO_TOTAL_ACTIVE_ITEMS_20261023: free items still own stock/BOM postings.
  if not exists(select 1 from public._fnb_active_kitchen_items_00454 i where i.kitchen_order_id=v_order.id and i.quantity>0)
     or exists(select 1 from public._fnb_active_kitchen_items_00454 i where i.kitchen_order_id=v_order.id
       and (i.quantity is null or i.unit_price is null or i.quantity<=0 or i.unit_price<0 or i.quantity in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) or i.unit_price in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)))
     or v_menu_subtotal < 0 or v_order_subtotal < 0 then$guard$;
  if position(old_fragment in d)=0 then raise exception 'FNB_ZERO_TOTAL_GUARD_CHANGED';end if;
  d:=replace(d,old_fragment,new_fragment);
  old_fragment:='if p_payment_method = ''mixed'' then';
  if position(old_fragment in d)=0 then raise exception 'FNB_ZERO_MIXED_GUARD_CHANGED';end if;
  d:=replace(d,old_fragment,$mixed$-- Zero settlement has no cash components; retain mixed method without fabricating a receipt.
  if p_payment_method='mixed' and p_paid=0 and (p_payment_breakdown is null or p_payment_breakdown='[]'::jsonb) then
    p_payment_breakdown:='[{"method":"cash","amount":0}]'::jsonb;
  end if;
  $mixed$||old_fragment);
  execute d;
 end if;
-- Pass the validated offline event only while the existing atomic checkout runs.
-- Restore the prior setting before idempotent return; no rewrite of an existing snapshot.
if to_regprocedure('public.fnb_complete_payment_timed_v1(jsonb,timestamptz)') is not null then
 d:=pg_get_functiondef('public.fnb_complete_payment_timed_v1(jsonb,timestamptz)'::regprocedure);
 if position('onebiz.fnb_paid_occurred_at' in d)=0 then
  old_fragment:='v_cash record;';
  if position(old_fragment in d)=0 then raise exception 'FNB_TIMED_CONTEXT_DECL_CHANGED';end if;
  d:=replace(d,old_fragment,old_fragment||' v_prior_paid_event text:=current_setting(''onebiz.fnb_paid_occurred_at'',true);');
  old_fragment:='v_result:=public.fnb_complete_payment_atomic_v3(';
  if position(old_fragment in d)=0 then raise exception 'FNB_TIMED_CONTEXT_CALL_CHANGED';end if;
  d:=replace(d,old_fragment,'perform set_config(''onebiz.fnb_paid_occurred_at'',p_occurred_at::text,true); '||old_fragment);
  old_fragment:='if coalesce((v_result->>''idempotent'')::boolean,false) then';
  if position(old_fragment in d)=0 then raise exception 'FNB_TIMED_CONTEXT_RETURN_CHANGED';end if;
  execute replace(d,old_fragment,'perform set_config(''onebiz.fnb_paid_occurred_at'',coalesce(v_prior_paid_event,''''),true); '||old_fragment);
 end if;
end if;
end $patch$;
notify pgrst,'reload schema';
commit;
