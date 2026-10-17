-- Definition-only: never rewrite historical stock, money, recipes or lots.
begin;
set local lock_timeout='3s';
create table public.stock_hardening_backups_00562(signature text primary key,definition text not null,captured_at timestamptz not null default now());
revoke all on public.stock_hardening_backups_00562 from public,anon,authenticated;
alter table public.stock_hardening_backups_00562 enable row level security;
insert into public.stock_hardening_backups_00562(signature,definition)
select p.oid::regprocedure::text,pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('allocate_lots_fifo','consume_bom_for_sale','_fnb_complete_payment_impl_00230','_fnb_complete_payment_checkout_impl_00345');

create or replace function public.allocate_lots_fifo(p_tenant_id uuid,p_product_id uuid,p_branch_id uuid,p_quantity numeric,p_source_type text,p_source_id uuid,p_allocated_by uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare remaining numeric:=p_quantity; allocated jsonb:='[]'; lot record; take numeric; allocation_time timestamptz:=clock_timestamp();
begin
 if p_tenant_id is null or p_product_id is null or p_branch_id is null or p_source_id is null
 or p_quantity is null or p_quantity<=0 or p_quantity::text in ('NaN','Infinity','-Infinity') then
 raise exception 'LOT_ALLOCATION_INPUT_INVALID' using errcode='22023';end if;
 for lot in select l.id,l.lot_number,l.current_qty,l.expiry_date,l.manufactured_date,l.expiry_at
 from public.product_lots l where l.tenant_id=p_tenant_id and l.product_id=p_product_id and l.branch_id=p_branch_id
 and l.status='active' and l.current_qty>0
 and (public._lot_expiry_moment_00527(l.expiry_date,l.expiry_at) is null or public._lot_expiry_moment_00527(l.expiry_date,l.expiry_at)>allocation_time)
 order by public._lot_expiry_moment_00527(l.expiry_date,l.expiry_at) asc nulls last,l.received_date,l.created_at,l.id
 for update
 loop
 exit when remaining<=0;
 take:=least(lot.current_qty,remaining);
 update public.product_lots set current_qty=current_qty-take,status=case when current_qty-take<=0 then 'consumed' else status end,updated_at=now() where id=lot.id;
 insert into public.lot_allocations(tenant_id,lot_id,source_type,source_id,quantity,allocated_by)
 values(p_tenant_id,lot.id,p_source_type,p_source_id,take,p_allocated_by);
 allocated:=allocated||jsonb_build_object('lot_id',lot.id,'lot_number',lot.lot_number,'quantity',take,'expiry_date',lot.expiry_date,'manufactured_date',lot.manufactured_date,'expiry_at',lot.expiry_at);
 remaining:=remaining-take;
 end loop;
 return jsonb_build_object('allocated',allocated,'remaining',remaining,'total_requested',p_quantity);
end $$;

-- Operational audit only: no second stock/cost ledger, no fabricated or expired lot.
-- The established sale policy remains authoritative; missing lots do not add a new sales block.
create function public._allocate_fnb_sale_lots_00562(p_tenant_id uuid,p_product_id uuid,p_branch_id uuid,p_quantity numeric,p_source_type text,p_source_id uuid,p_allocated_by uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;shortage numeric;
begin
 result:=public.allocate_lots_fifo(p_tenant_id,p_product_id,p_branch_id,p_quantity,p_source_type,p_source_id,p_allocated_by);
 shortage:=(result->>'remaining')::numeric;
 if shortage>0 then
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(p_tenant_id,p_allocated_by,'fnb_sale_lot_allocation_shortfall','invoice',p_source_id,
 jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'requested',p_quantity,
 'allocated_quantity',p_quantity-shortage,'unallocated_quantity',shortage,'reason','NO_ELIGIBLE_LOT','stock_policy_unchanged',true));
 end if;
 return result;
end $$;

-- Union for the entire bill, including legacy toppings. No recursive BTP expansion.
create function public._lock_fnb_checkout_products_00562(p_order uuid,p_tenant uuid,p_branch uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare ids uuid[];locked_count integer;
begin
 with seeds as (
 select i.product_id,i.variant_id from public.kitchen_order_items i where i.kitchen_order_id=p_order
 union
 select nullif(t->>'product_id','')::uuid,null::uuid from public.kitchen_order_items i
 cross join lateral jsonb_array_elements(case when jsonb_typeof(i.toppings)='array' then i.toppings else '[]'::jsonb end) t
 where i.kitchen_order_id=p_order and coalesce((t->>'quantity')::numeric,0)>0
 ), ingredients as (
 select b.material_id as id from seeds s join public.bom_items b
 on b.bom_id=public.get_active_bom_for_branch(s.product_id,p_branch,s.variant_id)
 ), linked as (
 select nullif(nullif(o->>'linkedProductId',''),'null')::uuid as id from public.kitchen_order_items i
 cross join lateral jsonb_array_elements(case when jsonb_typeof(i.modifier_selections)='array' then i.modifier_selections else '[]'::jsonb end) g
 cross join lateral jsonb_array_elements(case when jsonb_typeof(g->'options')='array' then g->'options' else '[]'::jsonb end) o
 where i.kitchen_order_id=p_order
 ), all_ids as (select product_id as id from seeds union select id from ingredients union select id from linked)
 select array_agg(id order by id) into ids from all_ids where id is not null;
 if ids is null then return;end if;
 perform p.id from public.products p where p.tenant_id=p_tenant and p.id=any(ids) order by p.id for update;
 get diagnostics locked_count=row_count;
 if locked_count<>cardinality(ids) then raise exception 'FNB_STOCK_PRODUCT_SCOPE_INVALID' using errcode='42501';end if;
end $$;

do $patch$
declare definition text;patched text;fn record;calls integer;
 pattern text:='begin\s+perform public\.allocate_lots_fifo\(([^;]+)\);\s+exception when others then null;\s+end;';
begin
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('consume_bom_for_sale','_fnb_complete_payment_impl_00230') loop
 definition:=pg_get_functiondef(fn.oid);
 select count(*) into calls from regexp_matches(definition,pattern,'g');
 if calls<>(case when fn.proname='consume_bom_for_sale' then 2 else 4 end) then
 raise exception 'FNB_00562_ALLOCATION_BOUNDARY_CHANGED: % (% calls)',fn.proname,calls;end if;
 patched:=regexp_replace(definition,pattern,'perform public._allocate_fnb_sale_lots_00562(\1);','g');
 if fn.proname='consume_bom_for_sale' then
 if strpos(patched,'order by p.id for share;')=0 then raise exception 'FNB_00562_UNIT_LOCK_BOUNDARY_CHANGED';end if;
 patched:=replace(patched,'order by p.id for share;','order by p.id for update;');
 end if;
 execute patched;
 end loop;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_fnb_complete_payment_impl_00230') then
 raise exception 'FNB_00562_POSTING_SIGNATURE_MISSING';end if;
 definition:=pg_get_functiondef('public._fnb_complete_payment_checkout_impl_00345(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'::regprocedure);
 if strpos(definition,'-- Retry trả lại hóa đơn đã có')=0 then raise exception 'FNB_00562_PAYMENT_LOCK_BOUNDARY_CHANGED';end if;
 patched:=replace(definition,'-- Retry trả lại hóa đơn đã có',
 E'if v_order.invoice_id is null then\n    perform public._lock_fnb_checkout_products_00562(p_kitchen_order_id,v_tenant_id,v_order.branch_id);\n  end if;\n\n  -- Retry trả lại hóa đơn đã có');
 execute patched;
end $patch$;

revoke all on function public.increment_product_stock(uuid,numeric),
 public.upsert_branch_stock(uuid,uuid,uuid,numeric),
 public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid),
 public.allocate_lots_fifo(uuid,uuid,uuid,numeric,text,uuid,uuid),
 public._allocate_fnb_sale_lots_00562(uuid,uuid,uuid,numeric,text,uuid,uuid),
 public._lock_fnb_checkout_products_00562(uuid,uuid,uuid)
from public,anon,authenticated;
notify pgrst,'reload schema';
commit;


