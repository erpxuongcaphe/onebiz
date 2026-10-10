-- Explicit branch policy. No existing stock, invoices or costs are rewritten.
begin;
set local lock_timeout='3s';
create temporary table _before_00473 on commit drop as select jsonb_build_object('branch', (select md5(string_agg(concat_ws('|',tenant_id,branch_id,product_id,variant_id,quantity),',' order by tenant_id,branch_id,product_id,variant_id)) from branch_stock), 'products',(select md5(string_agg(id::text||':'||coalesce(stock,0)::text,',' order by id)) from products), 'costs',(select md5(string_agg(concat_ws('|',tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost),',' order by tenant_id,branch_id,product_id)) from fnb_branch_product_cost_balances),'movements',(select count(*) from stock_movements),'invoices',(select count(*) from invoices),'lines',(select md5(string_agg(id::text||':'||coalesce(unit_cost::text,'NULL'),',' order by id)) from invoice_items)) as state;
create function public._allow_negative_sale_00473(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select case when jsonb_typeof(value)='boolean' then value::text::boolean end
 from tenant_settings where tenant_id=p_tenant and key='allow_negative_stock:'||p_branch::text),
 case when public._fnb_branch_cost_tracking_enabled_00390(p_tenant,p_branch) then false
 else public.get_tenant_setting(p_tenant,'allow_negative_stock','true'::jsonb)::text::boolean end);
$$;
revoke all on function public._allow_negative_sale_00473(uuid,uuid) from public,anon,authenticated;

create function public.branch_sale_stock_policy_00473(p_branch uuid,p_allow boolean default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid; v_role text;
begin
 select tenant_id,role into v_tenant,v_role from profiles where id=v_actor and coalesce(is_active,true);
 if v_tenant is null or not public.user_has_branch_access(v_actor,p_branch)
 or not exists(select 1 from branches where id=p_branch and tenant_id=v_tenant) then
 raise exception using errcode='42501',message='BRANCH_STOCK_POLICY_DENIED'; end if;
 if p_allow is not null then
 if v_role not in ('owner','admin') then raise exception using errcode='42501',message='BRANCH_STOCK_POLICY_DENIED'; end if;
 perform public.set_tenant_setting('allow_negative_stock:'||p_branch::text,to_jsonb(p_allow),'Cho phép bán thiếu tồn tại chi nhánh');
 end if;
 return public._allow_negative_sale_00473(v_tenant,p_branch);
end; $$;
revoke all on function public.branch_sale_stock_policy_00473(uuid,boolean) from public,anon;
grant execute on function public.branch_sale_stock_policy_00473(uuid,boolean) to authenticated;

alter table public.fnb_branch_product_cost_balances
 add column deficit_quantity numeric(18,4) not null default 0 check(deficit_quantity>=0);
-- Each shortage is tied to its real stock movement. Receipt settles it FIFO;
-- historical invoice snapshots remain unchanged. Differences remain auditable.
create table public.fnb_sale_cost_shortfalls_00473(
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
 branch_id uuid not null references branches(id),product_id uuid not null references products(id),
 cost_event_id uuid not null unique references fnb_branch_product_cost_events(id),
 invoice_id uuid,quantity numeric(18,4) not null check(quantity>0),
 pending_quantity numeric(18,4) not null check(pending_quantity>=0 and pending_quantity<=quantity),
 estimated_unit_cost numeric(18,6) not null check(estimated_unit_cost>=0),
 cost_known boolean not null,settled_actual_cost numeric(18,4) not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.fnb_sale_cost_shortfalls_00473 enable row level security;
create policy read_branch_shortfalls on public.fnb_sale_cost_shortfalls_00473 for select to authenticated
using(tenant_id=(select tenant_id from profiles where id=auth.uid() and coalesce(is_active,true))
 and public.user_has_branch_access(auth.uid(),branch_id)
 and (public.user_has_permission(auth.uid(),'products.view') or public.user_has_permission(auth.uid(),'system.view_audit')));
grant select on public.fnb_sale_cost_shortfalls_00473 to authenticated;
create index on public.fnb_sale_cost_shortfalls_00473(tenant_id,branch_id,product_id,created_at) where pending_quantity>0;

create or replace function public._post_fnb_branch_cost_out_00390(
 p_tenant_id uuid,p_branch_id uuid,p_product_id uuid,p_quantity numeric,p_source_type text,
 p_source_reference_type text,p_source_reference_id uuid,p_source_stock_movement_id uuid default null,
 p_note text default null,p_actor uuid default null
) returns numeric language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.fnb_branch_product_cost_balances%rowtype; v_unit numeric; v_known boolean;
 v_used numeric; v_short numeric; v_event uuid;
begin
 if p_quantity is null or p_quantity<=0 then raise exception 'FNB_BRANCH_COST_INPUT_INVALID'; end if;
 if p_source_stock_movement_id is not null then
 select unit_cost into v_unit from fnb_branch_product_cost_events where source_stock_movement_id=p_source_stock_movement_id;
 if found then return v_unit; end if; end if;
 insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,updated_by)
 values(p_tenant_id,p_branch_id,p_product_id,p_actor) on conflict(tenant_id,branch_id,product_id) do nothing;
 select * into b from fnb_branch_product_cost_balances where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=p_product_id for update;
 if p_source_stock_movement_id is not null then
 select unit_cost into v_unit from fnb_branch_product_cost_events where source_stock_movement_id=p_source_stock_movement_id;
 if found then return v_unit; end if; end if;
 v_used:=least(b.costed_quantity,p_quantity); v_short:=p_quantity-v_used;
 if v_short>0.0001 and not (p_source_type='bom_consume' and public._allow_negative_sale_00473(p_tenant_id,p_branch_id)) then
 raise exception using errcode='P0001',message='FNB_BRANCH_COST_REQUIRED'; end if;
 v_unit:=b.unit_cost; v_known:=b.costed_quantity>0 or b.opening_cost_confirmed;
 if not v_known then
 select unit_cost into v_unit from fnb_branch_product_cost_events where tenant_id=p_tenant_id
 and branch_id=p_branch_id and product_id=p_product_id and direction='in' order by created_at desc,id desc limit 1;
 v_known:=found; v_unit:=coalesce(v_unit,0);
 end if;
 update fnb_branch_product_cost_balances set costed_quantity=greatest(0,costed_quantity-v_used),
 total_cost=greatest(0,round(total_cost-v_used*b.unit_cost,4)),
 deficit_quantity=deficit_quantity+v_short,unit_cost=v_unit,updated_by=p_actor,updated_at=now()
 where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=p_product_id;
 insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,
 source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
 values(p_tenant_id,p_branch_id,p_product_id,'out',p_source_type,p_source_reference_type,p_source_reference_id,
 p_source_stock_movement_id,p_quantity,v_unit,round(p_quantity*v_unit,4),p_note,p_actor) returning id into v_event;
 if v_short>0 then
 insert into fnb_sale_cost_shortfalls_00473(tenant_id,branch_id,product_id,cost_event_id,invoice_id,quantity,pending_quantity,estimated_unit_cost,cost_known)
 values(p_tenant_id,p_branch_id,p_product_id,v_event,p_source_reference_id,v_short,v_short,v_unit,v_known);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(p_tenant_id,p_actor,'fnb_sale_stock_shortfall','invoice',p_source_reference_id,
 jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'quantity',v_short,'unit_cost',v_unit,'cost_known',v_known,'movement_id',p_source_stock_movement_id));
 end if;
 return v_unit;
end; $$;

create or replace function public._post_fnb_branch_cost_in_00390(
 p_tenant_id uuid,p_branch_id uuid,p_product_id uuid,p_quantity numeric,p_unit_cost numeric,p_source_type text,
 p_source_reference_type text,p_source_reference_id uuid,p_source_stock_movement_id uuid default null,
 p_note text default null,p_actor uuid default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.fnb_branch_product_cost_balances%rowtype; s record; v_settle numeric; v_left numeric;
 v_take numeric; v_total numeric; v_qty numeric;
begin
 if p_quantity is null or p_quantity<=0 or p_unit_cost is null or p_unit_cost<0 then raise exception 'FNB_BRANCH_COST_INPUT_INVALID'; end if;
 if p_source_stock_movement_id is not null and exists(select 1 from fnb_branch_product_cost_events where source_stock_movement_id=p_source_stock_movement_id) then return; end if;
 insert into fnb_branch_product_cost_balances(tenant_id,branch_id,product_id,updated_by)
 values(p_tenant_id,p_branch_id,p_product_id,p_actor) on conflict(tenant_id,branch_id,product_id) do nothing;
 select * into b from fnb_branch_product_cost_balances where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=p_product_id for update;
 if p_source_stock_movement_id is not null and exists(select 1 from fnb_branch_product_cost_events where source_stock_movement_id=p_source_stock_movement_id) then return; end if;
 v_settle:=least(b.deficit_quantity,p_quantity); v_left:=v_settle;
 for s in select * from fnb_sale_cost_shortfalls_00473 where tenant_id=p_tenant_id and branch_id=p_branch_id
 and product_id=p_product_id and pending_quantity>0
 order by case when p_source_type='invoice_void_restore' and invoice_id=p_source_reference_id then 0 else 1 end,created_at,id for update loop
 exit when v_left<=0; v_take:=least(v_left,s.pending_quantity);
 update fnb_sale_cost_shortfalls_00473 set pending_quantity=pending_quantity-v_take,
 settled_actual_cost=settled_actual_cost+round(v_take*p_unit_cost,4),updated_at=now() where id=s.id;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(p_tenant_id,p_actor,'fnb_stock_shortfall_settled','invoice',s.invoice_id,
 jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'quantity',v_take,
 'estimated_unit_cost',s.estimated_unit_cost,'received_unit_cost',p_unit_cost,
 'difference',round(v_take*(p_unit_cost-s.estimated_unit_cost),4),'source_id',p_source_reference_id));
 v_left:=v_left-v_take;
 end loop;
 if v_left>0 then raise exception 'FNB_COST_SHORTFALL_LEDGER_MISMATCH'; end if;
 v_qty:=b.costed_quantity+p_quantity-v_settle;
 v_total:=round(b.total_cost+(p_quantity-v_settle)*p_unit_cost,4);
 update fnb_branch_product_cost_balances set costed_quantity=v_qty,total_cost=v_total,
 deficit_quantity=deficit_quantity-v_settle,unit_cost=case when v_qty>0 then round(v_total/v_qty,6) else p_unit_cost end,
 updated_by=p_actor,updated_at=now() where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=p_product_id;
 insert into fnb_branch_product_cost_events(tenant_id,branch_id,product_id,direction,source_type,
 source_reference_type,source_reference_id,source_stock_movement_id,quantity,unit_cost,total_cost,note,created_by)
 values(p_tenant_id,p_branch_id,p_product_id,'in',p_source_type,p_source_reference_type,p_source_reference_id,
 p_source_stock_movement_id,p_quantity,p_unit_cost,round(p_quantity*p_unit_cost,4),p_note,p_actor);
end; $$;

-- Patch the deployed recipe function without changing its quantity rules.
do $patch$
declare d text; old_text text:=$old$(public.get_tenant_setting(p_tenant_id, 'allow_negative_stock', 'true'::jsonb))::boolean,$old$;
 pattern text; material text;
begin
 d:=pg_get_functiondef('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'::regprocedure);
 if strpos(d,old_text)=0 then raise exception 'BRANCH_STOCK_POLICY_PATCH_MISMATCH'; end if;
 d:=replace(d,old_text,'public._allow_negative_sale_00473(p_tenant_id,p_branch_id),');
 foreach material in array array['v_item.material_id','v_linked_id'] loop
 pattern:=E'select coalesce\\(sum\\(quantity\\), 0\\) into v_available from public\\.branch_stock[[:space:]]+where product_id = '||replace(material,'.',E'\\.');
 if material='v_item.material_id' and d !~ pattern then raise exception 'BRANCH_STOCK_LOCK_PATCH_MISMATCH'; end if;
 d:=regexp_replace(d,pattern,
 'perform public.upsert_branch_stock(p_tenant_id,p_branch_id,'||material||E',0);\nperform 1 from public.branch_stock where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id='||material||E' and variant_id is null for update;\n\\&','g');
 end loop;
 execute d;
end; $patch$;

-- Unknown cost is never presented as zero-cost profit. Existing reports already
-- distinguish NULL snapshots as missing cost. Only newly completed bills change.
do $patch$
declare d text; anchor text:='update public.invoice_items';
begin
 d:=pg_get_functiondef('public._snapshot_fnb_invoice_line_cost_00412(uuid,bigint,numeric)'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'FNB_UNKNOWN_COST_SNAPSHOT_PATCH_MISMATCH'; end if;
 execute replace(d,anchor,$new$  if exists(select 1 from public.fnb_sale_cost_shortfalls_00473
 where tenant_id=v_line.tenant_id and branch_id=v_line.branch_id and invoice_id=v_line.invoice_id and not cost_known) then
 update public.invoice_items set unit_cost=null where invoice_id=v_line.invoice_id;
 return;
 end if;
$new$||anchor);
end; $patch$;

-- Incoming physical lots cover stock already consumed before receipt. Defer
-- until stock, cost events and all receipt lots exist in the same transaction.
-- Only a newly inserted lot is reduced; never rewrite old lots or create stock.
create function public._settle_negative_sale_lot_00473()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_stock numeric; v_total numeric; v_qty numeric; v_take numeric;
begin
 if new.variant_id is not null or not exists(select 1 from fnb_sale_cost_shortfalls_00473
 where tenant_id=new.tenant_id and branch_id=new.branch_id and product_id=new.product_id
 and updated_at=now()) then return null; end if;
 select quantity into v_stock from branch_stock where tenant_id=new.tenant_id and branch_id=new.branch_id
 and product_id=new.product_id and variant_id is null for update;
 select current_qty into v_qty from product_lots where id=new.id and status='active' for update;
 if coalesce(v_qty,0)<=0 then return null; end if;
 select coalesce(sum(current_qty),0) into v_total from product_lots where tenant_id=new.tenant_id
 and branch_id=new.branch_id and product_id=new.product_id and status in ('active','expired');
 v_take:=least(v_qty,greatest(0,v_total-greatest(0,coalesce(v_stock,0))));
 if v_take>0 then
 update product_lots set current_qty=current_qty-v_take,status=case when current_qty-v_take<=0 then 'consumed' else status end,
 updated_at=now() where id=new.id;
 insert into lot_allocations(tenant_id,lot_id,source_type,source_id,quantity,allocated_by)
 values(new.tenant_id,new.id,'reconciliation',new.id,v_take,auth.uid());
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(new.tenant_id,auth.uid(),'fnb_negative_sale_lot_settled','product_lot',new.id,
 jsonb_build_object('branch_id',new.branch_id,'product_id',new.product_id,'quantity',v_take,'branch_stock',v_stock));
 end if;
 return null;
end; $$;
revoke all on function public._settle_negative_sale_lot_00473() from public,anon,authenticated;
create constraint trigger settle_negative_sale_lot_00473 after insert on public.product_lots
deferrable initially deferred for each row execute function public._settle_negative_sale_lot_00473();
do $$ begin if (select state from _before_00473) is distinct from jsonb_build_object('branch', (select md5(string_agg(concat_ws('|',tenant_id,branch_id,product_id,variant_id,quantity),',' order by tenant_id,branch_id,product_id,variant_id)) from branch_stock), 'products',(select md5(string_agg(id::text||':'||coalesce(stock,0)::text,',' order by id)) from products), 'costs',(select md5(string_agg(concat_ws('|',tenant_id,branch_id,product_id,costed_quantity,total_cost,unit_cost),',' order by tenant_id,branch_id,product_id)) from fnb_branch_product_cost_balances),'movements',(select count(*) from stock_movements),'invoices',(select count(*) from invoices),'lines',(select md5(string_agg(id::text||':'||coalesce(unit_cost::text,'NULL'),',' order by id)) from invoice_items)) then raise exception 'EXISTING_STOCK_OR_INVOICE_CHANGED'; end if; end $$;
commit;
notify pgrst,'reload schema';
