-- Attribute checkout cost events and finalize invoice costs after actual receipts.
-- No historical backfill here. No quantity, money, product price or Retail writes.
begin;
set local lock_timeout = '1s';
do $$begin
 if (select md5(replace(prosrc,E'\r\n',E'\n')) from pg_proc
 where oid='public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)'::regprocedure)
 is distinct from '030baa49f9ae870d3abf80f99f1af82c' then
  raise exception 'FNB_COST_SNAPSHOT_CHANGED_REVIEW_REQUIRED';
 end if;
end$$;

create table private.fnb_cost_event_lines_20261029 (
  event_id uuid primary key references public.fnb_branch_product_cost_events(id) on delete restrict,
  invoice_item_id uuid not null references public.invoice_items(id) on delete restrict
);
create index fnb_cost_event_lines_item_20261029 on private.fnb_cost_event_lines_20261029(invoice_item_id);
alter table private.fnb_cost_event_lines_20261029 enable row level security;
revoke all on private.fnb_cost_event_lines_20261029 from public,anon,authenticated;

create table private.fnb_cost_finalize_queue_20261029 (
  -- Operational pointer, deliberately no FK: its implicit KEY SHARE lock would
  -- block a receipt behind a concurrently edited/voided invoice. Worker checks
  -- the invoice tenant/branch/state and removes orphaned jobs explicitly.
  invoice_id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  actor_id uuid not null,
  actor_origin text not null,
  updated_at timestamptz not null default now(),
  attempted_at timestamptz,
  reason text
);
create index fnb_cost_finalize_queue_tenant_20261029 on private.fnb_cost_finalize_queue_20261029(tenant_id,updated_at,invoice_id);
alter table private.fnb_cost_finalize_queue_20261029 enable row level security;
revoke all on private.fnb_cost_finalize_queue_20261029 from public,anon,authenticated;

create function private.preview_fnb_settled_cost_20261029(p_invoice uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with inv as (
 select * from public.invoices where id=p_invoice and source='fnb' and status='completed' and deleted_at is null
), lines as (select ii.* from public.invoice_items ii join inv i on i.id=ii.invoice_id),
ef as (
 select e.id,e.product_id,e.quantity,
 e.total_cost+coalesce(sum(f.settled_actual_cost-f.quantity*f.estimated_unit_cost),0) amount,
 coalesce(sum(f.pending_quantity),0) pending,
 coalesce(sum(f.quantity),0)<=e.quantity as valid_shortfall
 from public.fnb_branch_product_cost_events e join inv i on e.source_reference_id=i.id
 and e.tenant_id=i.tenant_id and e.branch_id=i.branch_id
 left join public.fnb_sale_cost_shortfalls_00473 f on f.cost_event_id=e.id
 where e.source_type='bom_consume' and e.source_reference_type='bom_consume' and e.direction='out'
 group by e.id,e.product_id,e.quantity,e.total_cost
), comp as (
 select c.* from public.fnb_invoice_item_bom_snapshot_components_00410 c join lines l on l.id=c.invoice_item_id
), cg as (select material_id,quantity,count(*) n from comp group by material_id,quantity),
eg as (select product_id,quantity,count(*) n,min(amount) lo,max(amount) hi from ef group by product_id,quantity),
mapping as (select m.* from private.fnb_cost_event_lines_20261029 m join ef on ef.id=m.event_id),
mode as (select exists(select 1 from mapping) linked),
guard as (
 select exists(select 1 from inv) and exists(select 1 from ef)
 and not exists(select 1 from public.sales_returns r where r.invoice_id=p_invoice and r.status in ('confirmed','completed'))
 and not exists(select 1 from ef where pending<>0 or not valid_shortfall or quantity<=0 or amount<0 or amount='NaN'::numeric)
 and not exists(select 1 from public.fnb_sale_cost_shortfalls_00473 f join inv i on i.id=f.invoice_id where f.pending_quantity>0)
 and not exists(select 1 from lines where quantity<=0 or quantity='NaN'::numeric)
 and case when (select linked from mode) then
   not exists(select 1 from ef left join mapping m on m.event_id=ef.id left join lines l on l.id=m.invoice_item_id where l.id is null)
 else
   exists(select 1 from comp) and not exists(
    select 1 from cg full join eg on cg.material_id=eg.product_id and cg.quantity=eg.quantity
    where cg.n is null or eg.n is null or cg.n<>eg.n or abs(eg.hi-eg.lo)>0.0001)
 end as valid
), amounts as (
 select l.id,l.quantity,l.unit_cost,
 case when (select linked from mode) then
  (select sum(ef.amount) from mapping m join ef on ef.id=m.event_id where m.invoice_item_id=l.id)
 else
  (select sum(eg.hi) from comp c join eg on eg.product_id=c.material_id and eg.quantity=c.quantity where c.invoice_item_id=l.id)
 end amount
 from lines l
), rows as (
 select id,unit_cost old_unit_cost,
 case when amount is not null then round(amount/quantity,4) else unit_cost end new_unit_cost,
 amount
 from amounts where quantity>0
)
select jsonb_build_object(
 'complete',(select valid from guard) and exists(select 1 from rows)
 and not exists(select 1 from rows where new_unit_cost is null or new_unit_cost<0 or new_unit_cost>=100000000000 or new_unit_cost='NaN'::numeric),
 'mode',case when (select linked from mode) then 'event_line_mapping' else 'historical_component_match' end,
 'rows',coalesce((select jsonb_agg(rows order by id) from rows),'[]'::jsonb),
 'event_ids',coalesce((select jsonb_agg(id order by id) from ef),'[]'::jsonb)
);
$$;
revoke all on function private.preview_fnb_settled_cost_20261029(uuid) from public,anon,authenticated;

create function private.try_finalize_fnb_cost_20261029(p_invoice uuid)
returns text language plpgsql security definer set search_path='' as $$
declare job record; inv record; preview jsonb; expected integer; locked integer; before_rows jsonb; changed integer;
begin
 select * into job from private.fnb_cost_finalize_queue_20261029 where invoice_id=p_invoice for update skip locked;
 if not found then return 'not_queued'; end if;
 if job.attempted_at=transaction_timestamp() then return 'already_attempted'; end if;
 select * into inv from public.invoices where id=p_invoice for update skip locked;
 if not found then
  if not exists(select 1 from public.invoices where id=p_invoice) then
   delete from private.fnb_cost_finalize_queue_20261029 where invoice_id=p_invoice;
   return 'not_applicable';
  end if;
  return 'busy';
 end if;
 if inv.source is distinct from 'fnb' or inv.status<>'completed' or inv.deleted_at is not null
 or inv.tenant_id<>job.tenant_id or inv.branch_id<>job.branch_id then
  update private.fnb_cost_finalize_queue_20261029 set reason='not_applicable',attempted_at=now() where invoice_id=p_invoice;
  return 'not_applicable';
 end if;
 select count(*) into expected from public.invoice_items where invoice_id=p_invoice;
 select count(*) into locked from (select id from public.invoice_items where invoice_id=p_invoice order by id for update skip locked) x;
 if locked<>expected then return 'busy'; end if;
 preview:=private.preview_fnb_settled_cost_20261029(p_invoice);
 if not coalesce((preview->>'complete')::boolean,false) then
  update private.fnb_cost_finalize_queue_20261029 set reason='pending_or_ambiguous',attempted_at=now() where invoice_id=p_invoice;
  return 'pending_or_ambiguous';
 end if;
 select jsonb_agg(jsonb_build_object('id',ii.id,'unit_cost',ii.unit_cost) order by ii.id) into before_rows
 from public.invoice_items ii where ii.invoice_id=p_invoice;
 update public.invoice_items ii set unit_cost=(r.value->>'new_unit_cost')::numeric
 from jsonb_array_elements(preview->'rows') r
 where ii.id=(r.value->>'id')::uuid and ii.invoice_id=p_invoice
 and ii.unit_cost is distinct from (r.value->>'new_unit_cost')::numeric;
 get diagnostics changed=row_count;
 if changed>0 then
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
  values(inv.tenant_id,job.actor_id,'fnb_invoice_cost_finalized','invoice',p_invoice,
  jsonb_build_object('lines',before_rows),preview||jsonb_build_object('source','settled_branch_cost','changed_lines',changed,'automatic',true,'actor_origin',job.actor_origin));
 end if;
 delete from private.fnb_cost_finalize_queue_20261029 where invoice_id=p_invoice;
 return case when changed>0 then 'finalized' else 'unchanged' end;
end; $$;
revoke all on function private.try_finalize_fnb_cost_20261029(uuid) from public,anon,authenticated;

create function private.enqueue_fnb_cost_finalize_20261029()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.fnb_cost_finalize_queue_20261029(invoice_id,tenant_id,branch_id,actor_id,actor_origin)
 select i.id,i.tenant_id,i.branch_id,coalesce(auth.uid(),i.created_by),
 case when auth.uid() is null then 'invoice_creator_fallback' else 'receipt_user' end from public.invoices i
 where i.id=new.invoice_id and i.source='fnb' and i.tenant_id=new.tenant_id and i.branch_id=new.branch_id
 on conflict(invoice_id) do update set updated_at=now(),actor_id=excluded.actor_id,actor_origin=excluded.actor_origin,attempted_at=null,reason=null;
 return new;
end; $$;
revoke all on function private.enqueue_fnb_cost_finalize_20261029() from public,anon,authenticated;
create trigger queue_fnb_settled_cost_20261029 after update of pending_quantity,settled_actual_cost
on public.fnb_sale_cost_shortfalls_00473 for each row
when (old.pending_quantity is distinct from new.pending_quantity or old.settled_actual_cost is distinct from new.settled_actual_cost)
execute function private.enqueue_fnb_cost_finalize_20261029();

create function private.defer_fnb_cost_finalize_20261029()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 begin
  perform private.try_finalize_fnb_cost_20261029(new.invoice_id);
 exception when others then
  -- Cost-only maintenance must not roll back an otherwise valid receipt.
  -- The savepoint restores any partially finalized line/audit writes.
  update private.fnb_cost_finalize_queue_20261029
  set reason='retry:'||sqlstate||':'||left(sqlerrm,300),attempted_at=now()
  where invoice_id=new.invoice_id;
 end;
 return null;
end; $$;
revoke all on function private.defer_fnb_cost_finalize_20261029() from public,anon,authenticated;
create constraint trigger finalize_fnb_settled_cost_20261029 after update
on public.fnb_sale_cost_shortfalls_00473 deferrable initially deferred for each row
when (old.pending_quantity is distinct from new.pending_quantity or old.settled_actual_cost is distinct from new.settled_actual_cost)
execute function private.defer_fnb_cost_finalize_20261029();

-- Service-only retry for busy invoices. The existing nightly reconciliation job
-- invokes it; no additional scheduler/extension or public editing permission.
create function public.process_fnb_cost_finalize_queue_20261029(p_tenant_id uuid,p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job record; state text; results jsonb:='[]'::jsonb;
begin
 if p_tenant_id is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'FNB_COST_QUEUE_INPUT_INVALID'; end if;
 for job in select invoice_id from private.fnb_cost_finalize_queue_20261029
 where tenant_id=p_tenant_id order by attempted_at nulls first,updated_at,invoice_id limit p_limit for update skip locked loop
  begin
   state:=private.try_finalize_fnb_cost_20261029(job.invoice_id);
  exception when others then
   state:='retry:'||sqlstate;
   update private.fnb_cost_finalize_queue_20261029 set reason=state||':'||left(sqlerrm,300),attempted_at=now() where invoice_id=job.invoice_id;
  end;
  results:=results||jsonb_build_array(jsonb_build_object('invoice_id',job.invoice_id,'state',state));
 end loop;
 return results;
end; $$;
revoke all on function public.process_fnb_cost_finalize_queue_20261029(uuid,integer) from public,anon,authenticated;
grant execute on function public.process_fnb_cost_finalize_queue_20261029(uuid,integer) to service_role;

create or replace function public._snapshot_fnb_invoice_line_cost_00412(p_invoice_item_id uuid,p_events_before bigint,p_cost_before numeric)
returns void language plpgsql security definer set search_path='' as $$
declare l record; event_count bigint; total numeric; unlinked bigint; unlinked_cost numeric;
begin
 select ii.invoice_id,ii.quantity,i.tenant_id,i.branch_id,i.source,p.inventory_role into l
 from public.invoice_items ii join public.invoices i on i.id=ii.invoice_id join public.products p on p.id=ii.product_id
 where ii.id=p_invoice_item_id;
 if not found or l.source is distinct from 'fnb' or l.quantity is null or l.quantity<=0
 or p_events_before is null or p_cost_before is null then raise exception 'FNB_00412_LINE_INVALID'; end if;
 if l.inventory_role is distinct from 'fnb_menu_item' then return; end if;
 select count(*),coalesce(sum(e.total_cost),0) into event_count,total
 from public.fnb_branch_product_cost_events e where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id
 and e.source_reference_id=l.invoice_id and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out';
 if event_count<p_events_before or total<p_cost_before then raise exception 'FNB_00412_COST_EVENT_CHANGED'; end if;
 select count(*),coalesce(sum(e.total_cost),0) into unlinked,unlinked_cost
 from public.fnb_branch_product_cost_events e where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id
 and e.source_reference_id=l.invoice_id and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out'
 and not exists(select 1 from private.fnb_cost_event_lines_20261029 m where m.event_id=e.id);
 -- Capture only the proven delta, never guess attribution from UUID ordering.
 if unlinked=event_count-p_events_before and abs(unlinked_cost-(total-p_cost_before))<=0.0001 then
  insert into private.fnb_cost_event_lines_20261029(event_id,invoice_item_id)
  select e.id,p_invoice_item_id from public.fnb_branch_product_cost_events e
  where e.tenant_id=l.tenant_id and e.branch_id=l.branch_id and e.source_reference_id=l.invoice_id
  and e.source_reference_type='bom_consume' and e.source_type='bom_consume' and e.direction='out'
  and not exists(select 1 from private.fnb_cost_event_lines_20261029 m where m.event_id=e.id)
  on conflict(event_id) do nothing;
 end if;
 if exists(select 1 from public.fnb_sale_cost_shortfalls_00473 f where f.tenant_id=l.tenant_id
 and f.branch_id=l.branch_id and f.invoice_id=l.invoice_id and f.pending_quantity>0) then
  update public.invoice_items set unit_cost=null where invoice_id=l.invoice_id;
  return;
 end if;
 update public.invoice_items set unit_cost=case when event_count>p_events_before then round((total-p_cost_before)/l.quantity,4) else null end
 where id=p_invoice_item_id;
end; $$;
revoke all on function public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric) from public,anon,authenticated;
commit;
