-- Supply-catalog approval belongs to recipe setup, not physical SKU receiving.
-- Preserve the authenticated commercial and actual-receiving implementations.
begin;
set local lock_timeout = '3s';
do $patch$
declare
  definition text;
  old_check text := $old$select 1 from public.fnb_supply_catalog c
             where c.tenant_id = v_tenant_id
               and c.branch_id = p_to_branch_id
               and c.product_id = (i->>'productId')::uuid$old$;
  new_check text := $new$select 1 from public.products p
             where p.tenant_id = v_tenant_id
               and p.id = (i->>'productId')::uuid
               and p.is_active
               and p.product_type = 'sku'
               and p.channel is distinct from 'fnb'
               and p.inventory_role is distinct from 'fnb_menu_item'$new$;
begin
  definition := replace(pg_get_functiondef('public._create_internal_sale_catalog_impl_00390(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)'::regprocedure), E'\r\n', E'\n');
  old_check := replace(old_check, E'\r\n', E'\n');
  new_check := replace(new_check, E'\r\n', E'\n');
  if (length(definition)-length(replace(definition,old_check,'')))/length(old_check) <> 1
    or (length(definition)-length(replace(definition,'FNB_SUPPLY_CATALOG_REQUIRED','')))/length('FNB_SUPPLY_CATALOG_REQUIRED') <> 1 then
    raise exception 'INTERNAL_RECEIVING_SKU_PATCH_MISMATCH';
  end if;
  definition := replace(definition,old_check,new_check);
  execute replace(definition,'FNB_SUPPLY_CATALOG_REQUIRED','INTERNAL_SALE_RETAIL_SKU_REQUIRED');
end $patch$;

-- Historical orders keep their original receiving contract. Only newly
-- dispatched F&B orders receive an immutable per-line treatment snapshot.
alter table public.internal_sales add column receiving_policy_version smallint not null default 0;
alter table public.internal_sale_items
  add column receiving_treatment text check(receiving_treatment in ('stock','expense','review')),
  add column receiving_product_id uuid references public.products(id),
  add column receiving_factor numeric(24,12) check(receiving_factor>0),
  add column receiving_reason text;

create function public._internal_receiving_policy_00570(
 p_tenant uuid,p_source uuid,p_destination uuid,p_product uuid
) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_refs uuid[]; v_direct_refs uuid[]; v_candidates jsonb; v_direct_candidates jsonb; v_product record;
 v_graph_incomplete boolean;
begin
 select * into v_product from products where id=p_product and tenant_id=p_tenant and is_active;
 if not found then raise exception 'INTERNAL_SALE_RETAIL_SKU_REQUIRED'; end if;
 if not _fnb_branch_cost_tracking_enabled_00390(p_tenant,p_destination) then
  return jsonb_build_object('treatment','stock','productId',p_product,'factor',1,'reason','retail_stock');
 end if;
 -- Branch-menu rules are read, never inferred from names or code prefixes.
 with recursive dependencies(product_id,path) as (
  select bi.material_id,array[p.id,bi.material_id] from products p
  join bom_items bi on bi.bom_id=get_active_bom_for_branch(p.id,p_destination,null)
  where p.tenant_id=p_tenant and p.is_active and p.channel='fnb'
   and (not exists(select 1 from fnb_product_branch_menu_scopes s where s.tenant_id=p_tenant and s.product_id=p.id)
    or case coalesce((select mode from fnb_product_branch_menu_policies where tenant_id=p_tenant and product_id=p.id),'only')
      when 'except' then not exists(select 1 from fnb_product_branch_menu_scopes s where s.tenant_id=p_tenant and s.product_id=p.id and s.branch_id=p_destination)
      else exists(select 1 from fnb_product_branch_menu_scopes s where s.tenant_id=p_tenant and s.product_id=p.id and s.branch_id=p_destination) end)
  union all
  select bi.material_id,d.path||bi.material_id from dependencies d
  join bom_items bi on bi.bom_id=get_active_bom_for_branch(d.product_id,p_destination,null)
  where not bi.material_id=any(d.path) and cardinality(d.path)<20
 ) select array_agg(distinct product_id),array_agg(distinct product_id) filter(where cardinality(path)=2),
  bool_or(cardinality(path)>=20 or exists(select 1 from bom_items bi where bi.bom_id=get_active_bom_for_branch(dependencies.product_id,p_destination,null) and bi.material_id=any(dependencies.path)))
 into v_refs,v_direct_refs,v_graph_incomplete from dependencies;
 if v_refs is null then
  return jsonb_build_object('treatment','review','reason','branch_recipe_not_ready');
 end if;
 if p_product=any(v_refs) then
  return jsonb_build_object('treatment','stock','productId',p_product,'factor',1,'reason','recipe_ingredient');
 end if;
 if v_graph_incomplete then return jsonb_build_object('treatment','review','reason','recipe_graph_incomplete'); end if;
 -- Safe packaging equivalence: one material, no waste, one stock unit output.
 -- Multi-ingredient production is not silently treated as a unit conversion.
 with packs as (
  select p.id,bi.material_id,
   bi.quantity*resolve_product_uom_factor(p_tenant,bi.material_id,bi.unit) factor
  from products p join bom b on b.id=get_active_bom_for_branch(p.id,p_source,null)
  join bom_items bi on bi.bom_id=b.id
  where p.tenant_id=p_tenant and p.is_active and (p.id=p_product or p.id=any(v_refs))
   and b.batch_size=1 and b.yield_qty=1 and coalesce(bi.waste_percent,0)=0
   and bi.quantity>0 and (select count(*) from bom_items x where x.bom_id=b.id)=1
 ), candidates as (
  select target.id,source.factor/target.factor factor from packs source join packs target on target.material_id=source.material_id
  where source.id=p_product and target.id=any(v_refs)
  union
  select source.material_id,source.factor from packs source where source.id=p_product and source.material_id=any(v_refs)
 ) select jsonb_agg(jsonb_build_object('productId',id,'factor',factor) order by id),
  jsonb_agg(jsonb_build_object('productId',id,'factor',factor) order by id) filter(where id=any(v_direct_refs))
 into v_candidates,v_direct_candidates from candidates;
 if jsonb_array_length(coalesce(v_direct_candidates,'[]'))>0 then v_candidates:=v_direct_candidates; end if;
 if jsonb_array_length(coalesce(v_candidates,'[]'))=1 then
  return v_candidates->0||jsonb_build_object('treatment','stock','reason','verified_pack_conversion');
 elsif jsonb_array_length(coalesce(v_candidates,'[]'))>1 then
  return jsonb_build_object('treatment','review','reason','ambiguous_pack_conversion');
 end if;
 return jsonb_build_object('treatment','expense','reason','branch_operations');
end; $$;
revoke all on function public._internal_receiving_policy_00570(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create function public._snapshot_internal_receiving_policy_00570() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_sale record; v_policy jsonb;
begin
 if tg_table_name='internal_sales' then
  if new.receipt_mode='actual' and _fnb_branch_cost_tracking_enabled_00390(new.tenant_id,new.to_branch_id) then
   new.receiving_policy_version:=1;
  end if;
  return new;
 end if;
 select * into v_sale from internal_sales where id=new.internal_sale_id;
 if v_sale.receiving_policy_version=1 then
  v_policy:=_internal_receiving_policy_00570(v_sale.tenant_id,v_sale.from_branch_id,v_sale.to_branch_id,new.product_id);
  new.receiving_treatment:=v_policy->>'treatment';
  new.receiving_product_id:=(v_policy->>'productId')::uuid;
  new.receiving_factor:=(v_policy->>'factor')::numeric;
  new.receiving_reason:=v_policy->>'reason';
 end if;
 return new;
end; $$;
revoke all on function public._snapshot_internal_receiving_policy_00570() from public,anon,authenticated;
create trigger snapshot_internal_sale_receiving_policy before insert on public.internal_sales
for each row execute function public._snapshot_internal_receiving_policy_00570();
create trigger snapshot_internal_sale_item_receiving_policy before insert on public.internal_sale_items
for each row execute function public._snapshot_internal_receiving_policy_00570();

create function public._guard_internal_receiving_snapshot_00570() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_table_name='internal_sales' then
  if new.receiving_policy_version is distinct from old.receiving_policy_version then raise exception 'INTERNAL_RECEIVING_SNAPSHOT_IMMUTABLE'; end if;
 elsif row(new.receiving_treatment,new.receiving_product_id,new.receiving_factor,new.receiving_reason)
  is distinct from row(old.receiving_treatment,old.receiving_product_id,old.receiving_factor,old.receiving_reason) then
  raise exception 'INTERNAL_RECEIVING_SNAPSHOT_IMMUTABLE';
 end if;
 return new;
end; $$;
revoke all on function public._guard_internal_receiving_snapshot_00570() from public,anon,authenticated;
create trigger guard_internal_sale_receiving_snapshot before update on public.internal_sales
for each row execute function public._guard_internal_receiving_snapshot_00570();
create trigger guard_internal_sale_item_receiving_snapshot before update on public.internal_sale_items
for each row execute function public._guard_internal_receiving_snapshot_00570();

-- Explicit usage confirmation is separate from the automatic snapshot and is
-- immutable once a line has any receipt history. It never changes a recipe.
create table public.internal_receiving_usage_confirmations (
 sale_item_id uuid primary key references public.internal_sale_items(id),tenant_id uuid not null references public.tenants(id),
 treatment text not null check(treatment='stock'),reason text not null check(length(trim(reason))>=3),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
alter table public.internal_receiving_usage_confirmations enable row level security;
revoke all on public.internal_receiving_usage_confirmations from public,anon,authenticated;

create table public.internal_receipt_expense_sources (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 sale_id uuid not null references public.internal_sales(id),receipt_id uuid not null references public.internal_sale_receipts(id),
 sale_item_id uuid not null references public.internal_sale_items(id),revision integer not null,
 event_id uuid unique references public.management_finance_events(id),
 quantity numeric(20,4) not null check(quantity>=0),amount numeric(18,2) not null check(amount>=0),
 consolidated_amount numeric(18,2) check(consolidated_amount>=0),source_unit_cost numeric(24,8),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),unique(receipt_id,sale_item_id,revision)
);
alter table public.internal_receipt_expense_sources enable row level security;
revoke all on public.internal_receipt_expense_sources from public,anon,authenticated;
create unique index internal_receipt_expense_active_line on public.internal_receipt_expense_sources(receipt_id,sale_item_id) where is_active;
create index internal_receipt_expense_sale on public.internal_receipt_expense_sources(tenant_id,sale_id);

create function public._sync_internal_receipt_expense_00570(
 p_sale uuid,p_receipt uuid,p_item uuid,p_quantity numeric,p_revision integer,p_note text,p_actor uuid
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare s internal_sales; i internal_sale_items; r internal_sale_receipts;
 v_category management_finance_categories; v_event uuid; v_number bigint; v_amount numeric;
 v_unit_cost numeric; v_counterparty text; v_date date; v_old uuid; v_previous record;
 v_quantity numeric; v_cumulative numeric:=0; v_allocated numeric:=0; v_target numeric;
 v_cost_allocated numeric:=0; v_cost_target numeric; v_cost_amount numeric; v_expense_revision integer;
begin
 select * into strict s from internal_sales where id=p_sale;
 select * into strict i from internal_sale_items where id=p_item and internal_sale_id=p_sale;
 select * into strict r from internal_sale_receipts where id=p_receipt and internal_sale_id=p_sale;
 if i.receiving_treatment is distinct from 'expense' or s.receiving_policy_version<>1 then
  raise exception 'INTERNAL_RECEIVE_EXPENSE_POLICY_INVALID'; end if;
 select source_unit_cost into v_unit_cost from internal_receipt_expense_sources
 where sale_item_id=p_item order by created_at,id limit 1;
 if not found then
  select case when count(*)=count(unit_cost) and count(distinct unit_cost)=1 then min(unit_cost) end into v_unit_cost
  from invoice_items where invoice_id=s.invoice_id and product_id=i.product_id;
 end if;
 -- Cumulative rounding keeps all partial receipts equal to the original line.
 -- A correction may replace later rounding allocations, retaining their dates.
 for r in select receipts.* from internal_sale_receipts receipts join internal_sale_receipt_items ri on ri.receipt_id=receipts.id
  where receipts.internal_sale_id=p_sale and ri.sale_item_id=p_item order by receipts.created_at,receipts.id loop
  select quantity into v_quantity from internal_sale_receipt_items where receipt_id=r.id and sale_item_id=p_item;
  v_cumulative:=v_cumulative+v_quantity;
  v_target:=case when v_cumulative=i.quantity then round(i.amount,2) else round(v_cumulative*i.unit_price,2) end;
  v_amount:=v_target-v_allocated; v_allocated:=v_target;
  v_cost_target:=round(v_cumulative*v_unit_cost,2);
  v_cost_amount:=v_cost_target-v_cost_allocated; v_cost_allocated:=v_cost_target;
  if v_amount<0 or v_cost_amount<0 then raise exception 'INTERNAL_RECEIVE_EXPENSE_PRECISION_REVIEW'; end if;
  select * into v_previous from internal_receipt_expense_sources where receipt_id=r.id and sale_item_id=p_item and is_active for update;
  if found and v_previous.quantity=v_quantity and v_previous.amount=v_amount
   and v_previous.consolidated_amount is not distinct from v_cost_amount then continue; end if;
  v_date:=(r.created_at at time zone 'Asia/Ho_Chi_Minh')::date;
  for v_old in select x.event_id from internal_receipt_expense_sources x join management_finance_events e on e.id=x.event_id
   where x.receipt_id=r.id and x.sale_item_id=p_item and x.is_active and e.status='posted' for update of e loop
   update management_finance_events set status='cancelled',cancellation_reason='Điều chỉnh thực nhận: '||coalesce(p_note,'') where id=v_old;
   insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
   values(s.tenant_id,p_actor,'internal_receipt_expense_revised','management_finance_event',v_old,jsonb_build_object('receipt_id',p_receipt,'revision',p_revision));
  end loop;
  update internal_receipt_expense_sources set is_active=false where receipt_id=r.id and sale_item_id=p_item and is_active;
  select coalesce(max(revision),0)+1 into v_expense_revision from internal_receipt_expense_sources where receipt_id=r.id and sale_item_id=p_item;
  v_event:=null;
 if v_amount>0 then
  select * into v_category from management_finance_categories where tenant_id=s.tenant_id and code='CP-VH-NOIBO' and kind='expense' and not is_group and is_active;
  if not found then raise exception 'INTERNAL_RECEIVE_EXPENSE_CATEGORY_REQUIRED'; end if;
  insert into management_finance_counters(tenant_id,kind) values(s.tenant_id,'expense') on conflict do nothing;
  update management_finance_counters set next_value=next_value+1 where tenant_id=s.tenant_id and kind='expense' returning next_value-1 into v_number;
  select name into v_counterparty from branches where id=s.from_branch_id and tenant_id=s.tenant_id;
  insert into management_finance_events(tenant_id,code,request_id,request_payload,category_id,category_code,category_name,kind,business_date,amount,counterparty,note,created_by)
  values(s.tenant_id,'CP'||lpad(v_number::text,greatest(6,length(v_number::text)),'0'),gen_random_uuid(),
   jsonb_build_object('source','internal_receipt','saleId',p_sale,'receiptId',r.id,'itemId',p_item,'revision',v_expense_revision),
   v_category.id,v_category.code,v_category.name,'expense',v_date,v_amount,coalesce(v_counterparty,'Kho giao hàng'),
   concat_ws(' · ',s.code,i.product_code||' - '||i.product_name,'Thực nhận '||v_quantity::text||' '||i.unit,nullif(trim(p_note),'')),p_actor)
  returning id into v_event;
  insert into management_finance_allocations(event_id,branch_id,recognition_date,amount) values(v_event,s.to_branch_id,v_date,v_amount);
  insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
  values(s.tenant_id,p_actor,'internal_receipt_expense_posted','management_finance_event',v_event,
   jsonb_build_object('sale_id',p_sale,'receipt_id',r.id,'sale_item_id',p_item,'quantity',v_quantity,'amount',v_amount));
 end if;
 insert into internal_receipt_expense_sources(tenant_id,sale_id,receipt_id,sale_item_id,revision,event_id,quantity,amount,consolidated_amount,source_unit_cost)
 values(s.tenant_id,p_sale,r.id,p_item,v_expense_revision,v_event,v_quantity,v_amount,v_cost_amount,v_unit_cost);
 end loop;
end; $$;
revoke all on function public._sync_internal_receipt_expense_00570(uuid,uuid,uuid,numeric,integer,text,uuid) from public,anon,authenticated;

-- A distinct source category lets management reports filter automatic receipts.
insert into public.management_finance_categories(tenant_id,code,name,kind,parent_id,cash_flow_activity)
select p.tenant_id,'CP-VH-NOIBO','Vật tư vận hành nội bộ','expense',p.id,'operating'
from public.management_finance_categories p where p.code='CP-VH' and p.is_group and p.kind='expense'
on conflict(tenant_id,code) do nothing;

do $receipt$
declare d text; a text; b text;
begin
 d:=replace(pg_get_functiondef('public.receive_internal_sale_actual(uuid,jsonb,uuid,text,uuid,integer)'::regprocedure),E'\r\n',E'\n');
 a:=E'  if not found then raise exception ''INTERNAL_RECEIVE_ITEM_NOT_FOUND''; end if;';
 b:=a||replace($usage$
  if exists(select 1 from public.internal_receiving_usage_confirmations where sale_item_id=v_line.id and tenant_id=v_tenant) then
   if nullif(v_item->>'receivingTreatment','') is not null and v_item->>'receivingTreatment'<>'stock' then raise exception 'INTERNAL_RECEIVE_USAGE_LOCKED'; end if;
  elsif nullif(v_item->>'receivingTreatment','') is not null and v_item->>'receivingTreatment'<>coalesce(v_line.receiving_treatment,'stock') then
   if v_item->>'receivingTreatment'<>'stock' or v_line.receiving_treatment<>'expense' or v_sale.receiving_policy_version<>1 or v_qty<=0 then raise exception 'INTERNAL_RECEIVE_USAGE_INVALID'; end if;
   if not user_has_permission(v_actor,'inventory.adjust') or not user_has_permission(v_actor,'products.edit') then raise exception 'INTERNAL_RECEIVE_USAGE_DENIED' using errcode='42501'; end if;
   if length(trim(coalesce(p_note,'')))<3 then raise exception 'INTERNAL_RECEIVE_USAGE_REASON_REQUIRED'; end if;
   if exists(select 1 from internal_sale_receipt_items where sale_item_id=v_line.id) then raise exception 'INTERNAL_RECEIVE_USAGE_LOCKED'; end if;
   insert into public.internal_receiving_usage_confirmations(sale_item_id,tenant_id,treatment,reason,created_by) values(v_line.id,v_tenant,'stock',trim(p_note),v_actor);
   insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(v_tenant,v_actor,'internal_receiving_usage_confirmed','internal_sale',p_sale_id,jsonb_build_object('item_id',v_line.id,'from','expense','to','stock','reason',p_note));
  end if;
  if exists(select 1 from public.internal_receiving_usage_confirmations where sale_item_id=v_line.id and tenant_id=v_tenant) then
   v_line.receiving_treatment:='stock'; v_line.receiving_product_id:=v_line.product_id; v_line.receiving_factor:=1;
  end if;
$usage$,E'\r\n',E'\n');
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_USAGE_PATCH_MISMATCH'; end if;
 d:=replace(d,a,b);
 a:=E'   v_has_change:=true;\n   if v_delta<0 then';
 b:=E'   v_has_change:=true;\n   if v_line.receiving_treatment=''review'' then raise exception ''INTERNAL_RECEIVE_POLICY_REVIEW_REQUIRED''; end if;\n   if v_line.receiving_treatment is distinct from ''expense'' then\n    if round(v_delta*coalesce(v_line.receiving_factor,1),4)=0 or abs(v_delta*coalesce(v_line.receiving_factor,1)-round(v_delta*coalesce(v_line.receiving_factor,1),4))>0.00000001\n     or round(abs(v_delta)*v_line.unit_price,4)<>round(abs(round(v_delta*coalesce(v_line.receiving_factor,1),4))*v_line.unit_price/coalesce(v_line.receiving_factor,1),4) then raise exception ''INTERNAL_RECEIVE_CONVERSION_PRECISION_REVIEW''; end if;\n    v_delta:=round(v_delta*coalesce(v_line.receiving_factor,1),4);\n    v_line.unit_price:=v_line.unit_price/coalesce(v_line.receiving_factor,1);\n    v_line.product_id:=coalesce(v_line.receiving_product_id,v_line.product_id);\n   if v_delta<0 then';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_STOCK_PATCH_MISMATCH'; end if;
 d:=replace(d,a,b);
 a:=E'  end if;\n  insert into internal_sale_receipt_items';
 b:=E'   end if;\n  end if;\n  insert into internal_sale_receipt_items';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_END_PATCH_MISMATCH'; end if;
 d:=replace(d,a,b);
 a:='on conflict(receipt_id,sale_item_id) do update set quantity=excluded.quantity;';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_EXPENSE_POST_PATCH_MISMATCH'; end if;
 execute replace(d,a,a||E'\n  if v_line.receiving_treatment=''expense'' then perform public._sync_internal_receipt_expense_00570(p_sale_id,v_receipt_id,v_line.id,v_qty,v_revision+1,p_note,v_actor); end if;');
 -- Report classification and conversion without disclosing prices to receivers.
 d:=replace(pg_get_functiondef('public.get_internal_receiving_workspace(uuid)'::regprocedure),E'\r\n',E'\n');
 a:='''received'',coalesce(q.quantity,0))';
 b:='''received'',coalesce(q.quantity,0),''treatment'',coalesce((select c.treatment from public.internal_receiving_usage_confirmations c where c.sale_item_id=i.id and c.tenant_id=s.tenant_id),i.receiving_treatment,''stock''),''receivingProductId'',coalesce(i.receiving_product_id,i.product_id),''receivingFactor'',coalesce(i.receiving_factor,1),''receivingReason'',i.receiving_reason,''receivingProductCode'',(select p.code from public.products p where p.id=coalesce(i.receiving_product_id,i.product_id)),''receivingUnit'',(select p.unit from public.products p where p.id=coalesce(i.receiving_product_id,i.product_id)))';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_WORKSPACE_PATCH_MISMATCH'; end if;
 execute replace(d,a,b);
 d:=replace(pg_get_functiondef('public.get_internal_receiving_workspace(uuid)'::regprocedure),E'\r\n',E'\n');
 a:='''invoiceId'',s.invoice_id,''items''';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_POLICY_VERSION_PATCH_MISMATCH'; end if;
 execute replace(d,a,'''invoiceId'',s.invoice_id,''policyVersion'',s.receiving_policy_version,''items''');
 d:=replace(pg_get_functiondef('public.receive_internal_sale_with_uom(uuid,jsonb,uuid,text,uuid,integer)'::regprocedure),E'\r\n',E'\n');
 a:='jsonb_build_object(''itemId'',line.id,''quantity'',qty)';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_RECEIVE_UOM_USAGE_PATCH_MISMATCH'; end if;
 execute replace(d,a,'jsonb_build_object(''itemId'',line.id,''quantity'',qty)||case when item ? ''receivingTreatment'' then jsonb_build_object(''receivingTreatment'',item->>''receivingTreatment'') else ''{}''::jsonb end');
end $receipt$;

do $guards$
declare d text; a text; p regprocedure;
begin
 foreach p in array array[
  'public.settle_management_finance_event(uuid,uuid,jsonb)'::regprocedure,
  'public.cancel_management_finance_event(uuid,text)'::regprocedure
 ] loop
  d:=replace(pg_get_functiondef(p),E'\r\n',E'\n');
  a:=E'begin\n';
  if strpos(d,a)=0 then raise exception 'INTERNAL_EXPENSE_GUARD_PATCH_MISMATCH'; end if;
  d:=overlay(d placing a||E' if exists(select 1 from public.internal_receipt_expense_sources where event_id=p_event_id) then\n raise exception ''INTERNAL_RECEIPT_FINANCE_SOURCE_LOCKED'' using errcode=''PT409''; end if;\n' from strpos(d,a) for length(a));
  execute d;
 end loop;
 d:=replace(pg_get_functiondef('public.cancel_internal_sale_atomic(uuid,text)'::regprocedure),E'\r\n',E'\n');
 a:=' update internal_sales set status=''cancelled''';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_EXPENSE_CANCEL_PATCH_MISMATCH'; end if;
 execute replace(d,a,E' update public.management_finance_events set status=''cancelled'',cancellation_reason=''Hủy đơn nội bộ: ''||p_reason\n where status=''posted'' and id in(select event_id from public.internal_receipt_expense_sources where tenant_id=v_tenant and sale_id=v_sale.id);\n update public.internal_receipt_expense_sources set is_active=false where tenant_id=v_tenant and sale_id=v_sale.id and is_active;\n'||a);
 d:=replace(pg_get_functiondef('public.get_management_finance_workspace(date,date,uuid,text,uuid,text,integer,integer,text,text,text)'::regprocedure),E'\r\n',E'\n');
 a:='to_jsonb(r)-''request_payload''-''rn''';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_EXPENSE_WORKSPACE_PATCH_MISMATCH'; end if;
 d:=replace(d,a,'(to_jsonb(r)-''request_payload''-''rn'')||coalesce((select jsonb_build_object(''source_type'',''internal_receipt'',''source_sale_id'',x.sale_id,''source_receipt_id'',x.receipt_id,''can_view_consolidated_cost'',public.user_has_permission(auth.uid(),''products.view_cost'') and public.user_has_branch_access(auth.uid(),s.from_branch_id),''consolidated_amount'',case when public.user_has_permission(auth.uid(),''products.view_cost'') and public.user_has_branch_access(auth.uid(),s.from_branch_id) then x.consolidated_amount end) from public.internal_receipt_expense_sources x join public.internal_sales s on s.id=x.sale_id and s.tenant_id=x.tenant_id where x.event_id=r.id),''{}''::jsonb)');
 a:='and (p_payment_state is null or (status=''posted'' and case p_payment_state';
 if (length(d)-length(replace(d,a,'')))/length(a)<>1 then raise exception 'INTERNAL_EXPENSE_PAYMENT_FILTER_PATCH_MISMATCH'; end if;
 execute replace(d,a,'and (p_payment_state is null or (not exists(select 1 from public.internal_receipt_expense_sources x where x.event_id=scoped.id) and status=''posted'' and case p_payment_state');
end $guards$;

create function public.management_finance_period_totals_00570(p_tenant_id uuid,p_from timestamptz,p_to timestamptz,p_branch_id uuid,p_consolidated boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 with manual as (
  select e.kind,a.amount from public.management_finance_events e join public.management_finance_allocations a on a.event_id=e.id
  where e.tenant_id=p_tenant_id and e.status='posted'
   and not exists(select 1 from public.internal_receipt_expense_sources x where x.event_id=e.id)
   and (a.recognition_date::timestamp at time zone 'Asia/Ho_Chi_Minh')>=p_from
   and (a.recognition_date::timestamp at time zone 'Asia/Ho_Chi_Minh')<p_to
   and (p_branch_id is null or a.branch_id=p_branch_id)
   and public.user_has_branch_access(auth.uid(),a.branch_id)
 ), received as (
  select x.* from public.internal_receipt_expense_sources x
  join public.internal_sales s on s.id=x.sale_id and s.tenant_id=x.tenant_id
  join public.internal_sale_receipts r on r.id=x.receipt_id and r.tenant_id=x.tenant_id
  left join public.management_finance_events e on e.id=x.event_id
  where x.tenant_id=p_tenant_id and x.is_active and s.status='completed'
   and (x.event_id is null or e.status='posted')
   and (((r.created_at at time zone 'Asia/Ho_Chi_Minh')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh')>=p_from
   and (((r.created_at at time zone 'Asia/Ho_Chi_Minh')::date)::timestamp at time zone 'Asia/Ho_Chi_Minh')<p_to
   and (p_branch_id is null or s.to_branch_id=p_branch_id)
   and public.user_has_branch_access(auth.uid(),s.to_branch_id)
 )
 select jsonb_build_object(
  'expense',coalesce((select sum(amount) from manual where kind='expense'),0)
   +coalesce((select sum(case when p_consolidated and p_branch_id is null then consolidated_amount else amount end) from received),0),
  'income',coalesce((select sum(amount) from manual where kind='income'),0),
  'branch_operating_expense',coalesce((select sum(amount) from manual where kind='expense'),0)+coalesce((select sum(amount) from received),0),
  'missing_expense_cost_lines',(select count(*) from received where p_consolidated and p_branch_id is null and consolidated_amount is null and quantity>0),
  'internal_expense_elimination',coalesce((select sum(amount-consolidated_amount) from received where p_consolidated and p_branch_id is null and consolidated_amount is not null),0));
$$;
revoke all on function public.management_finance_period_totals_00570(uuid,timestamptz,timestamptz,uuid,boolean) from public,anon,authenticated;

-- Existing P&L clients already suppress profit when source cost is incomplete.
-- Do not turn an unknown internal source cost into zero-cost profit.
do $report$
declare d text; a text; b text;
begin
 d:=replace(pg_get_functiondef('public.get_profit_and_loss_report_v2(timestamptz,timestamptz,timestamptz,timestamptz,uuid,boolean)'::regprocedure),E'\r\n',E'\n');
 a:='public.management_finance_period_totals(v_tenant_id,p.date_from,p.date_to,p_branch_id)';
 if (length(d)-length(replace(d,a,'')))/length(a)<>2 then raise exception 'INTERNAL_EXPENSE_PNL_SOURCE_PATCH_MISMATCH'; end if;
 d:=replace(d,a,'public.management_finance_period_totals_00570(v_tenant_id,p.date_from,p.date_to,p_branch_id,v_exclude_internal)');
 a:='to_jsonb(s) - ''period''';
 b:='(to_jsonb(s) - ''period'')||jsonb_build_object(''cogs_complete'',s.cogs_complete and (public.management_finance_period_totals_00570(v_tenant_id,p.date_from,p.date_to,p_branch_id,v_exclude_internal)->>''missing_expense_cost_lines'')::bigint=0,''missing_expense_cost_lines'',(public.management_finance_period_totals_00570(v_tenant_id,p.date_from,p.date_to,p_branch_id,v_exclude_internal)->>''missing_expense_cost_lines'')::bigint,''internal_expense_elimination'',(public.management_finance_period_totals_00570(v_tenant_id,p.date_from,p.date_to,p_branch_id,v_exclude_internal)->>''internal_expense_elimination'')::numeric)';
 -- The period bounds must be selected from periods, not an out-of-scope CTE alias.
 b:=replace(b,'p.date_from','(select date_from from periods where period=s.period)');
 b:=replace(b,'p.date_to','(select date_to from periods where period=s.period)');
 b:=replace(b,'''missing_expense_cost_lines'',','''branch_operating_expense'',s.legacy_cash_expense+(public.management_finance_period_totals_00570(v_tenant_id,(select date_from from periods where period=s.period),(select date_to from periods where period=s.period),p_branch_id,v_exclude_internal)->>''branch_operating_expense'')::numeric,''missing_expense_cost_lines'',');
 if (length(d)-length(replace(d,a,'')))/length(a)<>2 then raise exception 'INTERNAL_EXPENSE_PNL_PATCH_MISMATCH'; end if;
 execute replace(d,a,b);
end $report$;

commit;
notify pgrst, 'reload schema';
