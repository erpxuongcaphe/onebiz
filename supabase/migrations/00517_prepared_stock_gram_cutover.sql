-- Infrastructure only. A separately reviewed transaction calls the private
-- cutover for an explicit product, old unit and declared gram factor.
begin;
set local lock_timeout='5s';
create table public.prepared_stock_unit_cutovers_00517 (
 product_id uuid primary key references public.products(id),tenant_id uuid not null,
 old_unit text not null,new_unit text not null default 'G',factor numeric not null check(factor>0),
 state text not null check(state in ('applying','completed')),transaction_id bigint not null,
 before_state jsonb not null,after_state jsonb,created_at timestamptz not null default now()
);
create table public.prepared_stock_unit_rows_00517 (
 product_id uuid not null references public.prepared_stock_unit_cutovers_00517(product_id),
 table_name text not null,row_id text not null,old_data jsonb not null,
 primary key(product_id,table_name,row_id)
);
alter table public.prepared_stock_unit_cutovers_00517 enable row level security;
alter table public.prepared_stock_unit_rows_00517 enable row level security;
revoke all on public.prepared_stock_unit_cutovers_00517,public.prepared_stock_unit_rows_00517 from public,anon,authenticated;

-- Preserve existing projections, options, owner and ACLs while increasing
-- per-unit money precision. No DROP CASCADE or permissions inferred by name.
do $precision$ declare v record;a record;begin
 create temporary table _gram_views_00517 on commit drop as
 select c.oid,c.relname,pg_get_viewdef(c.oid,true) definition,c.reloptions,c.relacl,c.relowner
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='v' and c.relname in
 ('products_scoped','production_orders_scoped','production_order_materials_scoped','stock_movements_scoped');
 create temporary table _gram_triggers_00517 on commit drop as
 select c.relname table_name,t.tgname,pg_get_triggerdef(t.oid) definition,t.tgenabled
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal and c.relname in
 ('products','stock_movements','production_orders','fnb_branch_product_cost_balances','fnb_branch_product_cost_events','fnb_sale_cost_shortfalls_00473');
 for v in select * from _gram_views_00517 loop execute format('drop view public.%I',v.relname);end loop;
 for v in select * from _gram_triggers_00517 loop execute format('drop trigger %I on public.%I',v.tgname,v.table_name);end loop;
 alter table public.products alter column cost_price type numeric(24,12),alter column sell_price type numeric(24,12);
 alter table public.stock_movements alter column unit_cost type numeric(24,12),alter column unit_price type numeric(24,12);
 alter table public.fnb_branch_product_cost_balances alter column unit_cost type numeric(24,12);
 alter table public.fnb_branch_product_cost_events alter column unit_cost type numeric(24,12);
 alter table public.fnb_sale_cost_shortfalls_00473 alter column estimated_unit_cost type numeric(24,12);
 alter table public.production_orders alter column planned_qty type numeric(20,4),alter column completed_qty type numeric(20,4);
 for v in select * from _gram_triggers_00517 loop
  execute v.definition;
  if v.tgenabled<>'O' then execute format('alter table public.%I %s trigger %I',v.table_name,
   case v.tgenabled when 'D' then 'disable' when 'A' then 'enable always' when 'R' then 'enable replica' end,v.tgname);end if;
 end loop;
 for v in select * from _gram_views_00517 loop
  execute format('create view public.%I %s as %s',v.relname,
   case when v.reloptions is null then '' else 'with ('||array_to_string(v.reloptions,',')||')' end,v.definition);
  execute format('alter view public.%I owner to %I',v.relname,pg_get_userbyid(v.relowner));
  for a in select * from aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) loop
   execute format('grant %s on public.%I to %s %s',a.privilege_type,v.relname,
    case when a.grantee=0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
    case when a.is_grantable then 'with grant option' else '' end);
  end loop;
 end loop;
end;$precision$;

create or replace function public.guard_product_stock_unit_00468()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if lower(trim(new.unit)) is distinct from lower(trim(old.unit)) and
 (exists(select 1 from stock_movements where product_id=old.id)
 or exists(select 1 from branch_stock where product_id=old.id and quantity<>0)
 or exists(select 1 from purchase_order_items where product_id=old.id)
 or exists(select 1 from invoice_items where product_id=old.id)
 or exists(select 1 from bom_items where material_id=old.id)) then
  -- An ordinary client cannot create this private, transaction-bound row.
  if not exists(select 1 from prepared_stock_unit_cutovers_00517 c where c.product_id=old.id
   and c.tenant_id=old.tenant_id and c.state='applying' and c.transaction_id=txid_current()
   and c.old_unit=old.unit and c.new_unit=new.unit and new.stock=old.stock*c.factor) then
   raise exception 'PRODUCT_STOCK_UNIT_LOCKED_BY_HISTORY' using errcode='55000';
  end if;
 end if;
 return new;
end;$$;

create function public.rebase_prepared_stock_to_grams_00517(p_product uuid,p_expected_unit text,p_factor numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;c record;ref record;n bigint;before_json jsonb;after_json jsonb;
begin
 if p_factor is null or p_factor<=0 or p_factor::text in ('NaN','Infinity','-Infinity') then raise exception 'GRAM_FACTOR_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended('gram-cutover:'||p_product::text,0));
 select * into p from products where id=p_product for update;
 if not found or not p.is_fnb_stock_item then raise exception 'GRAM_PREPARED_PRODUCT_REQUIRED';end if;
 select * into c from prepared_stock_unit_cutovers_00517 where product_id=p_product;
 if found then
  if c.state<>'completed' or c.old_unit<>p_expected_unit or c.factor<>p_factor or p.unit<>c.new_unit then raise exception 'GRAM_CUTOVER_CONFLICT';end if;
  return jsonb_build_object('replayed',true,'productId',p_product,'factor',c.factor);
 end if;
 if p.unit<>p_expected_unit or p.stock_unit is distinct from p.unit then raise exception 'GRAM_STOCK_UNIT_CHANGED';end if;
 select count(*) into n from uom_conversions where product_id=p_product and tenant_id=p.tenant_id and is_active
  and from_unit=p_expected_unit and to_unit='G' and factor=p_factor;
 if n<>1 then raise exception 'GRAM_DECLARED_FACTOR_REQUIRED';end if;
 if exists(select 1 from uom_conversions where product_id=p_product and is_active and
  (from_unit<>p_expected_unit or to_unit<>'G' or factor<>p_factor)) then raise exception 'GRAM_EXTRA_CONVERSIONS_REVIEW_REQUIRED';end if;
 if exists(select 1 from production_orders where product_id=p_product and status not in ('completed','cancelled')) then raise exception 'GRAM_OPEN_PRODUCTION_REVIEW_REQUIRED';end if;
 -- Detect new/dependent business rows instead of silently scaling unknown docs.
 for ref in
 select distinct tc.table_name,kcu.column_name from information_schema.table_constraints tc
 join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.constraint_schema=tc.constraint_schema
 join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema
 where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' and ccu.table_schema='public' and ccu.table_name='products'
 and tc.table_name not in ('bom','bom_items','bom_modifier_option_quantities','branch_stock','products',
 'product_lots','stock_movements','fnb_branch_product_cost_balances','fnb_branch_product_cost_events',
 'fnb_invoice_item_bom_snapshot_components_00410','fnb_sale_cost_shortfalls_00473','production_orders',
 'uom_conversions','prepared_stock_unit_cutovers_00517')
 loop
  execute format('select count(*) from public.%I where %I=$1',ref.table_name,ref.column_name) into n using p_product;
  if n<>0 then raise exception 'GRAM_DEPENDENCY_REVIEW_REQUIRED: %',ref.table_name;end if;
 end loop;
 if exists(select 1 from bom_items where material_id=p_product and (input_quantity is null or input_unit is null))
 or exists(select 1 from bom_modifier_option_quantities where material_id=p_product and (input_quantity is null or input_unit is null)) then raise exception 'GRAM_ORIGINAL_RECIPE_INPUT_REQUIRED';end if;
 -- Lock every mutable quantity/cost row before taking the comparison snapshot.
 perform 1 from branch_stock where product_id=p_product order by id for update;
 perform 1 from product_lots where product_id=p_product order by id for update;
 perform 1 from fnb_branch_product_cost_balances where product_id=p_product order by branch_id for update;
 before_json:=jsonb_build_object('product',to_jsonb(p),
  'branches',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from branch_stock s where product_id=p_product),
  'lots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from product_lots s where product_id=p_product),
  'balances',(select coalesce(jsonb_agg(to_jsonb(s) order by branch_id),'[]') from fnb_branch_product_cost_balances s where product_id=p_product),
  'movementNet',(select coalesce(sum(case when type='in' then quantity else -quantity end),0) from stock_movements where product_id=p_product));
 insert into prepared_stock_unit_cutovers_00517(product_id,tenant_id,old_unit,factor,state,transaction_id,before_state)
 values(p_product,p.tenant_id,p.unit,p_factor,'applying',txid_current(),before_json);
 insert into prepared_stock_unit_rows_00517 values(p_product,'products',p_product::text,to_jsonb(p));
 for ref in select * from (values
 ('branch_stock','product_id'),('product_lots','product_id'),('stock_movements','product_id'),
 ('fnb_branch_product_cost_events','product_id'),('fnb_sale_cost_shortfalls_00473','product_id'),
 ('bom','product_id'),('bom_items','material_id'),('bom_modifier_option_quantities','material_id'),
 ('production_orders','product_id'),('fnb_invoice_item_bom_snapshot_components_00410','material_id')
 ) specs(table_name,column_name) loop
  execute format('insert into prepared_stock_unit_rows_00517 select $1,%L,id::text,to_jsonb(t) from public.%I t where %I=$1',ref.table_name,ref.table_name,ref.column_name) using p_product;
 end loop;
 insert into prepared_stock_unit_rows_00517 select p_product,'fnb_branch_product_cost_balances',branch_id::text,to_jsonb(s)
 from fnb_branch_product_cost_balances s where product_id=p_product;
 -- This is unit normalization, not a new receipt or cost event.
 update products set unit='G',stock_unit='G',sell_unit='G',stock=stock*p_factor,
  min_stock=min_stock*p_factor,max_stock=max_stock*p_factor,cost_price=cost_price/p_factor,sell_price=sell_price/p_factor where id=p_product;
 update branch_stock set quantity=quantity*p_factor,reserved=reserved*p_factor where product_id=p_product;
 update product_lots set initial_qty=initial_qty*p_factor,current_qty=current_qty*p_factor where product_id=p_product;
 update stock_movements set quantity=quantity*p_factor,unit_cost=unit_cost/p_factor,unit_price=unit_price/p_factor where product_id=p_product;
 update fnb_branch_product_cost_balances set costed_quantity=costed_quantity*p_factor,
  deficit_quantity=deficit_quantity*p_factor,unit_cost=unit_cost/p_factor where product_id=p_product;
 update fnb_branch_product_cost_events set quantity=quantity*p_factor,unit_cost=unit_cost/p_factor where product_id=p_product;
 update fnb_sale_cost_shortfalls_00473 set quantity=quantity*p_factor,pending_quantity=pending_quantity*p_factor,
  estimated_unit_cost=estimated_unit_cost/p_factor where product_id=p_product;
 update production_orders set planned_qty=planned_qty*p_factor,completed_qty=completed_qty*p_factor where product_id=p_product;
 update bom set yield_qty=yield_qty*p_factor,yield_unit='G',
  note=concat_ws(E'\n',note,'Đơn vị kho G; mẻ chuẩn '||p_factor::text||' G. Quy cách cũ được bảo lưu trong lịch sử chuyển đơn vị.') where product_id=p_product;
 -- Touch input fields rather than multiply already-rounded recipe quantities.
 update bom_items set input_quantity=input_quantity where material_id=p_product;
 update bom_modifier_option_quantities q set quantity=round(q.input_quantity*resolve_product_uom_factor(p.tenant_id,p_product,q.input_unit),4) where material_id=p_product;
 perform public.sync_product_bom_uom_00465(p_product);
 after_json:=jsonb_build_object('product',(select to_jsonb(s) from products s where id=p_product),
  'branches',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from branch_stock s where product_id=p_product),
  'lots',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from product_lots s where product_id=p_product),
  'balances',(select coalesce(jsonb_agg(to_jsonb(s) order by branch_id),'[]') from fnb_branch_product_cost_balances s where product_id=p_product),
  'movementNet',(select coalesce(sum(case when type='in' then quantity else -quantity end),0) from stock_movements where product_id=p_product));
 if (after_json#>>'{product,stock}')::numeric<>(before_json#>>'{product,stock}')::numeric*p_factor
 or abs((after_json#>>'{product,stock}')::numeric*(after_json#>>'{product,cost_price}')::numeric
  -(before_json#>>'{product,stock}')::numeric*(before_json#>>'{product,cost_price}')::numeric)>0.0001
 or (after_json->>'movementNet')::numeric<>(before_json->>'movementNet')::numeric*p_factor
 or exists(select 1 from prepared_stock_unit_rows_00517 r join branch_stock s on s.id::text=r.row_id
  where r.product_id=p_product and r.table_name='branch_stock' and (s.quantity<>(r.old_data->>'quantity')::numeric*p_factor or s.reserved<>(r.old_data->>'reserved')::numeric*p_factor))
 or exists(select 1 from prepared_stock_unit_rows_00517 r join product_lots s on s.id::text=r.row_id
  where r.product_id=p_product and r.table_name='product_lots' and (s.initial_qty<>(r.old_data->>'initial_qty')::numeric*p_factor or s.current_qty<>(r.old_data->>'current_qty')::numeric*p_factor))
 or exists(select 1 from prepared_stock_unit_rows_00517 r join fnb_branch_product_cost_balances s on s.product_id=r.product_id and s.branch_id::text=r.row_id
  where r.product_id=p_product and r.table_name='fnb_branch_product_cost_balances' and (s.total_cost<>(r.old_data->>'total_cost')::numeric or s.costed_quantity<>(r.old_data->>'costed_quantity')::numeric*p_factor or s.deficit_quantity<>(r.old_data->>'deficit_quantity')::numeric*p_factor))
 or exists(select 1 from prepared_stock_unit_rows_00517 r join fnb_branch_product_cost_events s on s.id::text=r.row_id
  where r.product_id=p_product and r.table_name='fnb_branch_product_cost_events' and (s.total_cost<>(r.old_data->>'total_cost')::numeric or s.quantity<>(r.old_data->>'quantity')::numeric*p_factor)) then raise exception 'GRAM_CUTOVER_CONSERVATION_FAILED';end if;
 update prepared_stock_unit_cutovers_00517 set state='completed',after_state=after_json where product_id=p_product;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,old_data,new_data)
 values(p.tenant_id,coalesce(auth.uid(),(select id from profiles where tenant_id=p.tenant_id and role='owner' order by created_at limit 1)),
 'prepared_stock_unit_cutover','product',p_product,jsonb_build_object('unit',p.unit,'quantity',p.stock),
 jsonb_build_object('unit','G','quantity',(after_json#>>'{product,stock}')::numeric,'factor',p_factor,'totalsPreserved',true));
 return jsonb_build_object('productId',p_product,'oldUnit',p.unit,'newUnit','G','factor',p_factor,'oldStock',p.stock,'stock',(after_json#>>'{product,stock}')::numeric,'replayed',false);
end;$$;
revoke all on function public.rebase_prepared_stock_to_grams_00517(uuid,text,numeric) from public,anon,authenticated,service_role;

-- Original quantity metadata only; private backups also contain cost fields.
create function public.get_prepared_stock_unit_history_00517(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshots jsonb;branch uuid;tenant uuid;r record;q numeric;
begin
 if not user_has_permission(auth.uid(),'inventory.view') then raise exception 'GRAM_HISTORY_DENIED' using errcode='42501';end if;
 select tenant_id into tenant from profiles where id=auth.uid() and coalesce(is_active,true);
 if p_kind not in ('production','stock_movement','lot') then raise exception 'GRAM_HISTORY_KIND_INVALID';end if;
 snapshots:='[]';
 for r in select b.old_data,c.old_unit,c.factor,c.product_id,p.name,p.code,c.tenant_id
 from prepared_stock_unit_rows_00517 b join prepared_stock_unit_cutovers_00517 c using(product_id)
 join products p on p.id=c.product_id where b.row_id=p_id::text and c.state='completed' and c.tenant_id=tenant
 and b.table_name=case p_kind when 'production' then 'production_orders' when 'stock_movement' then 'stock_movements' else 'product_lots' end
 loop
  branch:=(r.old_data->>'branch_id')::uuid;
  if not _can_read_branch_inventory_00476(auth.uid(),tenant,branch) then raise exception 'GRAM_HISTORY_BRANCH_DENIED' using errcode='42501';end if;
  q:=(r.old_data->>case p_kind when 'production' then 'completed_qty' when 'stock_movement' then 'quantity' else 'initial_qty' end)::numeric;
  snapshots:=snapshots||jsonb_build_array(jsonb_build_object('productId',r.product_id,'productName',r.name,'productCode',r.code,
   'inputQuantity',q,'inputUnit',r.old_unit,'conversionFactor',r.factor,'stockQuantity',q*r.factor,'stockUnit','G','source','unit_cutover'));
 end loop;
 return snapshots;
end;$$;
revoke all on function public.get_prepared_stock_unit_history_00517(text,uuid) from public,anon;
grant execute on function public.get_prepared_stock_unit_history_00517(text,uuid) to authenticated;

-- Patch verified function boundaries, retaining their owners, ACLs and auth
-- guards. Abort on schema drift rather than replace an unknown implementation.
do $helpers$ declare definition text;old_fragment text;new_fragment text;begin
 definition:=pg_get_functiondef('public._restore_fnb_invoice_item_bom_00410(uuid,uuid,uuid,uuid,numeric,uuid,uuid,text,uuid)'::regprocedure);
 old_fragment:='select c.material_id, c.unit, sum(c.quantity)::numeric(18,4) as source_quantity';
 new_fragment:='select c.material_id, case when c.unit=r.old_unit then r.new_unit else c.unit end as unit,
      sum(c.quantity * case when c.unit=r.old_unit then r.factor else 1 end)::numeric(18,4) as source_quantity';
 if position(old_fragment in definition)=0 then raise exception 'GRAM_RETURN_IMPLEMENTATION_CHANGED';end if;
 definition:=replace(definition,old_fragment,new_fragment);
 definition:=replace(definition,'from public.fnb_invoice_item_bom_snapshot_components_00410 c',
 'from public.fnb_invoice_item_bom_snapshot_components_00410 c
      left join public.prepared_stock_unit_cutovers_00517 r on r.product_id=c.material_id and r.state=''completed''');
 definition:=replace(definition,'group by c.material_id, c.unit','group by c.material_id, c.unit,r.old_unit,r.new_unit,r.factor');
 execute definition;
 definition:=pg_get_functiondef('public.consume_bom_for_sale(uuid,uuid,uuid,numeric,uuid,uuid,text,jsonb,boolean,uuid)'::regprocedure);
 old_fragment:='if v_bom_id is not null then';
 if position(old_fragment in definition)=0 then raise exception 'GRAM_CONSUMPTION_IMPLEMENTATION_CHANGED';end if;
 definition:=replace(definition,old_fragment,old_fragment||'
    -- Serialize recipe reads with a stock-unit cutover before computing qty.
    perform 1 from public.products p where p.id in
      (select material_id from public.bom_items where bom_id=v_bom_id)
      order by p.id for share;');
 execute definition;
 definition:=pg_get_functiondef('public.sync_product_cost_from_bom(uuid)'::regprocedure);
 if position('round(public.bom_unit_cost(ct.id), 2)' in definition)=0 then raise exception 'GRAM_COST_SYNC_IMPLEMENTATION_CHANGED';end if;
 definition:=replace(definition,'round(public.bom_unit_cost(ct.id), 2)',
 'round(public.bom_unit_cost(ct.id),case when exists(select 1 from public.prepared_stock_unit_cutovers_00517 where product_id=p_product_id) then 12 else 2 end)');
 execute definition;
 definition:=pg_get_functiondef('public.bom_unit_cost(uuid)'::regprocedure);
 if position('coalesce(b.yield_qty, 1), 4)' in definition)=0 then raise exception 'GRAM_BOM_COST_IMPLEMENTATION_CHANGED';end if;
 definition:=replace(definition,'coalesce(b.yield_qty, 1), 4)',
 'coalesce(b.yield_qty, 1),case when exists(select 1 from public.prepared_stock_unit_cutovers_00517 where product_id=b.product_id) then 12 else 4 end)');
 execute definition;
end;$helpers$;

alter function public.create_production_order_atomic(jsonb) rename to _create_production_before_gram_00517;
revoke all on function public._create_production_before_gram_00517(jsonb) from public,anon,authenticated;
create function public.create_production_order_atomic(p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p record;actor_tenant uuid;material jsonb;begin
 select tenant_id into actor_tenant from profiles where id=auth.uid() and coalesce(is_active,true);
 select id,unit into p from products where id=(p_input->>'product_id')::uuid and tenant_id=actor_tenant for share;
 if not found then raise exception 'PRODUCTION_PRODUCT_ACCESS_DENIED' using errcode='42501';end if;
 if exists(select 1 from prepared_stock_unit_cutovers_00517 where product_id=p.id and state='completed')
 and (p_input->>'stock_unit') is distinct from p.unit then raise exception 'GRAM_FORM_REFRESH_REQUIRED';end if;
 for material in select value from jsonb_array_elements(coalesce(p_input->'materials','[]')) order by value->>'product_id' loop
  perform 1 from products where id=(material->>'product_id')::uuid and tenant_id=actor_tenant for share;
  if exists(select 1 from prepared_stock_unit_cutovers_00517 c join products m on m.id=c.product_id
   where c.product_id=(material->>'product_id')::uuid and c.state='completed' and (material->>'unit') is distinct from m.unit) then
   raise exception 'GRAM_FORM_REFRESH_REQUIRED';
  end if;
 end loop;
 return _create_production_before_gram_00517(p_input);
end;$$;
revoke all on function public.create_production_order_atomic(jsonb) from public,anon;
grant execute on function public.create_production_order_atomic(jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
