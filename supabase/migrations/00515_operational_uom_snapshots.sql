-- Unit-entry wrappers preserve the current 4dp stock ledger and its historical
-- units. Original weights and factors are immutable snapshots, not inferred
-- later from a product's current settings. No existing quantity is rewritten.
begin;
set local lock_timeout='5s';
create table if not exists public.operational_uom_requests (
 reference_type text not null check(reference_type in ('production','internal_receipt','transfer','internal_export','disposal','inventory_check')),
 request_id uuid not null, tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id), to_branch_id uuid references public.branches(id), reference_id uuid not null,
 payload jsonb not null, snapshots jsonb not null, result jsonb not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 primary key(reference_type,request_id)
);
create index if not exists operational_uom_reference_idx on public.operational_uom_requests(tenant_id,reference_type,reference_id,created_at desc);
create index if not exists operational_uom_document_code_idx on public.operational_uom_requests(tenant_id,reference_type,(result->>'code'));
alter table public.operational_uom_requests enable row level security;
do $$begin
 if not exists(select 1 from pg_policies where schemaname='public' and tablename='operational_uom_requests' and policyname='operational_uom_read') then
 execute $policy$create policy operational_uom_read on public.operational_uom_requests for select to authenticated
 using (public.user_has_permission(auth.uid(),'inventory.view') and
 (public._can_read_branch_inventory_00476(auth.uid(),tenant_id,branch_id) or
 (reference_type='transfer' and public._can_read_branch_inventory_00476(auth.uid(),tenant_id,to_branch_id))))$policy$;
 end if;
end;$$;
revoke all on public.operational_uom_requests from public,anon,authenticated;
grant select on public.operational_uom_requests to authenticated;

create or replace function public.complete_production_with_uom(
 p_production_order_id uuid,p_input_quantity numeric,p_input_unit text,p_expected_factor numeric default null,
 p_lot_number text default null,p_manufactured_date date default current_date,p_expiry_date date default null,p_material_inputs jsonb default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid;po record;existing record;factor numeric;qty numeric;lot uuid;payload jsonb;snapshot jsonb;stock_unit text;product_name text;product_code text;material jsonb;line record;material_snapshots jsonb:='[]';
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not user_has_permission(actor,'production.complete_order') then raise exception 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED' using errcode='42501';end if;
 select * into po from production_orders where id=p_production_order_id and tenant_id=tenant for update;
 if not found or not user_has_branch_access(actor,po.branch_id) then raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 payload:=jsonb_build_object('quantity',p_input_quantity,'unit',trim(p_input_unit),'expectedFactor',p_expected_factor,'lot',p_lot_number,'manufactured',p_manufactured_date,'expiry',p_expiry_date,'materials',p_material_inputs);
 select * into existing from operational_uom_requests where reference_type='production' and request_id=po.id;
 if found then
  if existing.tenant_id<>tenant or existing.payload<>payload then raise exception 'UOM_REQUEST_CHANGED';end if;
  return (existing.result->>'lotId')::uuid;
 end if;
 if p_input_quantity is null or p_input_quantity<=0 or p_input_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'UOM_QUANTITY_INVALID';end if;
 perform 1 from products where tenant_id=tenant and (id=po.product_id or id in(select product_id from production_order_materials where production_order_id=po.id)) order by id for update;
 select unit,name,code into stock_unit,product_name,product_code from products where id=po.product_id and tenant_id=tenant for update;
 factor:=resolve_product_uom_factor(tenant,po.product_id,p_input_unit);
 if p_expected_factor is not null and round(factor,12)<>round(p_expected_factor,12) then raise exception 'UOM_CONVERSION_CHANGED';end if;
 qty:=round(p_input_quantity*factor,4);
 if qty<=0 then raise exception 'UOM_QUANTITY_BELOW_LEDGER_PRECISION';end if;
 if p_material_inputs is not null then
  if jsonb_typeof(p_material_inputs)<>'array' or jsonb_array_length(p_material_inputs)<>(select count(*) from production_order_materials where production_order_id=po.id)
   or jsonb_array_length(p_material_inputs)<>(select count(distinct value->>'productId') from jsonb_array_elements(p_material_inputs)) then raise exception 'UOM_MATERIAL_INPUTS_INVALID';end if;
  perform 1 from products where tenant_id=tenant and id in(select product_id from production_order_materials where production_order_id=po.id) order by id for update;
  for material in select value from jsonb_array_elements(p_material_inputs) order by value->>'productId' loop
   select m.planned_qty,m.unit,p.id,p.unit stock_unit,p.name,p.code into line from production_order_materials m join products p on p.id=m.product_id and p.tenant_id=tenant where m.production_order_id=po.id and m.product_id=(material->>'productId')::uuid;
   if not found or lower(trim(line.unit))<>lower(trim(line.stock_unit)) then raise exception 'UOM_MATERIAL_INPUTS_INVALID';end if;
   if (material->>'quantity')::numeric is null or (material->>'quantity')::numeric<=0 or (material->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'UOM_QUANTITY_INVALID';end if;
   if material ? 'expectedFactor' and round((material->>'expectedFactor')::numeric,12)<>round(resolve_product_uom_factor(tenant,line.id,material->>'unit'),12) then raise exception 'UOM_CONVERSION_CHANGED';end if;
   if round((material->>'quantity')::numeric*resolve_product_uom_factor(tenant,line.id,material->>'unit'),4)<>round(line.planned_qty,4) then raise exception 'UOM_MATERIAL_INPUTS_INVALID';end if;
   material_snapshots:=material_snapshots||jsonb_build_array(jsonb_build_object('role','material','productId',line.id,'productName',line.name,'productCode',line.code,'inputQuantity',(material->>'quantity')::numeric,'inputUnit',material->>'unit','conversionFactor',resolve_product_uom_factor(tenant,line.id,material->>'unit'),'stockQuantity',round(line.planned_qty,4),'stockUnit',line.stock_unit));
  end loop;
 end if;
 lot:=complete_production_atomic(po.id,qty,p_lot_number,p_manufactured_date,p_expiry_date);
 snapshot:=jsonb_build_object('productId',po.product_id,'productName',product_name,'productCode',product_code,'inputQuantity',p_input_quantity,'inputUnit',trim(p_input_unit),'conversionFactor',factor,'stockQuantity',qty,'stockUnit',stock_unit);
 insert into operational_uom_requests(reference_type,request_id,tenant_id,branch_id,reference_id,payload,snapshots,result,created_by)
 values('production',po.id,tenant,po.branch_id,po.id,payload,jsonb_build_array(snapshot)||material_snapshots,jsonb_build_object('lotId',lot,'code',po.code),actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(tenant,actor,'production_uom_recorded','production_order',po.id,snapshot);
 return lot;
end;$$;
revoke all on function public.complete_production_with_uom(uuid,numeric,text,numeric,text,date,date,jsonb) from public,anon;
grant execute on function public.complete_production_with_uom(uuid,numeric,text,numeric,text,date,date,jsonb) to authenticated;

create or replace function public.receive_internal_sale_with_uom(
 p_sale_id uuid,p_items jsonb,p_request_id uuid,p_note text default null,p_receipt_id uuid default null,p_expected_revision integer default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid;sale record;existing record;item jsonb;line record;factor numeric;qty numeric;input_qty numeric;input_unit text;
 normalized jsonb:='[]';snapshots jsonb:='[]';payload jsonb;result jsonb;
begin
 select tenant_id into tenant from profiles where id=actor and is_active;
 if tenant is null or not user_has_permission(actor,'inventory.create_po') then raise exception 'INTERNAL_RECEIVE_DENIED' using errcode='42501';end if;
 select * into sale from internal_sales where id=p_sale_id and tenant_id=tenant for update;
 if not found or not user_has_branch_access(actor,sale.to_branch_id) then raise exception 'INTERNAL_RECEIVE_BRANCH_DENIED' using errcode='42501';end if;
 if p_receipt_id is not null and not user_has_permission(actor,'inventory.adjust') then raise exception 'INTERNAL_RECEIVE_ADJUST_DENIED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'INTERNAL_RECEIVE_ITEMS_REQUIRED';end if;
 select jsonb_agg(value order by value->>'itemId') into payload from jsonb_array_elements(p_items);
 payload:=jsonb_build_object('sale',p_sale_id,'items',payload,'receipt',p_receipt_id,'revision',p_expected_revision,'note',nullif(trim(p_note),''));
 perform pg_advisory_xact_lock(hashtextextended('uom:'||p_request_id::text,0));
 select * into existing from operational_uom_requests where reference_type='internal_receipt' and request_id=p_request_id;
 if found then
  if existing.tenant_id<>tenant or existing.payload<>payload then raise exception 'UOM_REQUEST_CHANGED';end if;
  return existing.result||jsonb_build_object('replayed',true);
 end if;
 perform 1 from products where id in(select product_id from internal_sale_items where internal_sale_id=sale.id) order by id for update;
 for item in select value from jsonb_array_elements(p_items) order by value->>'itemId' loop
  select i.*,p.unit stock_unit into line from internal_sale_items i join products p on p.id=i.product_id and p.tenant_id=tenant where i.id=(item->>'itemId')::uuid and i.internal_sale_id=sale.id;
  if not found then raise exception 'INTERNAL_RECEIVE_ITEM_NOT_FOUND';end if;
  input_qty:=(item->>'quantity')::numeric;
  if input_qty is null or input_qty<0 or input_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'UOM_QUANTITY_INVALID';end if;
  input_unit:=coalesce(nullif(trim(item->>'inputUnit'),''),line.stock_unit);
  factor:=resolve_product_uom_factor(tenant,line.product_id,input_unit);
  if item ? 'expectedFactor' and round((item->>'expectedFactor')::numeric,12)<>round(factor,12) then raise exception 'UOM_CONVERSION_CHANGED';end if;
  qty:=round(input_qty*factor,4);
  if input_qty>0 and qty=0 then raise exception 'UOM_QUANTITY_BELOW_LEDGER_PRECISION';end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('itemId',line.id,'quantity',qty));
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('itemId',line.id,'productId',line.product_id,'productName',line.product_name,'productCode',line.product_code,'inputQuantity',input_qty,'inputUnit',input_unit,'conversionFactor',factor,'stockQuantity',qty,'stockUnit',line.stock_unit));
 end loop;
 result:=receive_internal_sale_actual(p_sale_id,normalized,p_request_id,p_note,p_receipt_id,p_expected_revision);
 insert into operational_uom_requests(reference_type,request_id,tenant_id,branch_id,reference_id,payload,snapshots,result,created_by)
 values('internal_receipt',p_request_id,tenant,sale.to_branch_id,(result->>'receiptId')::uuid,payload,snapshots,result,actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(tenant,actor,'internal_receipt_uom_recorded','internal_sale',sale.id,jsonb_build_object('receiptId',result->>'receiptId','items',snapshots));
 return result;
end;$$;
revoke all on function public.receive_internal_sale_with_uom(uuid,jsonb,uuid,text,uuid,integer) from public,anon;
grant execute on function public.receive_internal_sale_with_uom(uuid,jsonb,uuid,text,uuid,integer) to authenticated;

create or replace function public.create_stock_operation_with_uom(
 p_kind text,p_branch_id uuid,p_items jsonb,p_request_id uuid,p_to_branch_id uuid default null,p_reason text default null,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid;existing record;item jsonb;product record;factor numeric;qty numeric;input_qty numeric;input_unit text;
 normalized jsonb:='[]';snapshots jsonb:='[]';payload jsonb;result jsonb;permission text;part jsonb;parts_quantity numeric;part_factor numeric;
begin
 permission:=case p_kind when 'transfer' then 'inventory.transfer' when 'disposal' then 'inventory.dispose' when 'internal_export' then 'inventory.internal_export' when 'inventory_check' then 'inventory.check' else null end;
 select tenant_id into tenant from profiles where id=actor and is_active;
 if tenant is null or permission is null or not user_has_permission(actor,permission) or not user_has_branch_access(actor,p_branch_id) then raise exception 'UOM_OPERATION_DENIED' using errcode='42501';end if;
 if p_kind='transfer' and not user_has_branch_access(actor,p_to_branch_id) then raise exception 'UOM_OPERATION_DENIED' using errcode='42501';end if;
 if p_request_id is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'UOM_ITEMS_REQUIRED';end if;
 if jsonb_array_length(p_items)<>(select count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then raise exception 'UOM_DUPLICATE_ITEM';end if;
 select jsonb_agg(value order by value->>'product_id') into payload from jsonb_array_elements(p_items);
 payload:=jsonb_build_object('kind',p_kind,'branch',p_branch_id,'to',p_to_branch_id,'reason',p_reason,'note',p_note,'items',payload);
 perform pg_advisory_xact_lock(hashtextextended('uom:'||p_request_id::text,0));
 select * into existing from operational_uom_requests where reference_type=p_kind and request_id=p_request_id;
 if found then
  if existing.tenant_id<>tenant or existing.payload<>payload then raise exception 'UOM_REQUEST_CHANGED';end if;
  return existing.result;
 end if;
 perform 1 from products where tenant_id=tenant and id in(select (value->>'product_id')::uuid from jsonb_array_elements(p_items)) order by id for update;
 for item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
  select id,unit,name,code into product from products where id=(item->>'product_id')::uuid and tenant_id=tenant and is_active;
  if not found then raise exception 'UOM_PRODUCT_NOT_FOUND';end if;
  input_qty:=(item->>'quantity')::numeric;
  if input_qty is null or input_qty<0 or (input_qty=0 and p_kind<>'inventory_check') or input_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'UOM_QUANTITY_INVALID';end if;
  input_unit:=coalesce(nullif(trim(item->>'inputUnit'),''),product.unit);
  factor:=resolve_product_uom_factor(tenant,product.id,input_unit);
  if item ? 'expectedFactor' and round((item->>'expectedFactor')::numeric,12)<>round(factor,12) then raise exception 'UOM_CONVERSION_CHANGED';end if;
  qty:=round(input_qty*factor,4);
  if input_qty>0 and qty<=0 then raise exception 'UOM_QUANTITY_BELOW_LEDGER_PRECISION';end if;
  if item ? 'parts' then
   if p_kind<>'inventory_check' or jsonb_typeof(item->'parts')<>'array' or jsonb_array_length(item->'parts') not between 1 and 10 then raise exception 'UOM_COUNT_PARTS_INVALID';end if;
   parts_quantity:=0;
   for part in select value from jsonb_array_elements(item->'parts') loop
    if (part->>'quantity')::numeric is null or (part->>'quantity')::numeric<0 or (part->>'quantity')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'UOM_QUANTITY_INVALID';end if;
    part_factor:=resolve_product_uom_factor(tenant,product.id,part->>'unit');
    if part ? 'expectedFactor' and round((part->>'expectedFactor')::numeric,12)<>round(part_factor,12) then raise exception 'UOM_CONVERSION_CHANGED';end if;
    parts_quantity:=parts_quantity+(part->>'quantity')::numeric*part_factor;
   end loop;
   if round(parts_quantity,4)<>qty then raise exception 'UOM_COUNT_PARTS_INVALID';end if;
  end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('product_id',product.id,case when p_kind='inventory_check' then 'actual_stock' else 'quantity' end,qty,'note',item->>'note'));
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('productId',product.id,'productName',product.name,'productCode',product.code,'inputQuantity',input_qty,'inputUnit',input_unit,'conversionFactor',factor,'stockQuantity',qty,'stockUnit',product.unit)||case when item ? 'parts' then jsonb_build_object('parts',item->'parts') else '{}'::jsonb end);
 end loop;
 if p_kind='transfer' then result:=create_stock_transfer_atomic(p_branch_id,p_to_branch_id,p_note,normalized);
 elsif p_kind='disposal' then result:=create_disposal_export_atomic(p_branch_id,p_reason,p_note,normalized);
 elsif p_kind='inventory_check' then result:=create_and_apply_inventory_check_atomic(p_branch_id,p_note,normalized);
 else result:=create_internal_export_atomic(p_branch_id,p_reason,p_note,normalized);end if;
 result:=jsonb_build_object('id',coalesce(result->'id',result->'check_id',result->'transfer_id'),'code',result->'code')
   ||case when p_kind='inventory_check' then jsonb_build_object('check_id',result->'check_id','status',result->'status')
     when p_kind='transfer' then jsonb_build_object('transfer_id',result->'transfer_id') else '{}'::jsonb end;
 if nullif(result->>'id','') is null or nullif(result->>'code','') is null then raise exception 'UOM_OPERATION_RESULT_INVALID';end if;
 insert into operational_uom_requests(reference_type,request_id,tenant_id,branch_id,to_branch_id,reference_id,payload,snapshots,result,created_by)
 values(p_kind,p_request_id,tenant,p_branch_id,case when p_kind='transfer' then p_to_branch_id end,(result->>'id')::uuid,payload,snapshots,result,actor);
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(tenant,actor,'stock_operation_uom_recorded',p_kind,(result->>'id')::uuid,jsonb_build_object('items',snapshots,'toBranch',p_to_branch_id));
 return result;
end;$$;
revoke all on function public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text) from public,anon;
grant execute on function public.create_stock_operation_with_uom(text,uuid,jsonb,uuid,uuid,text,text) to authenticated;
commit;
notify pgrst,'reload schema';
