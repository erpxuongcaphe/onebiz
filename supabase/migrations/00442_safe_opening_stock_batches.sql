-- Adds an explicit, atomic opening workflow. No existing stock is backfilled.
begin;
set local lock_timeout = '3s';

create table public.inventory_opening_batches (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  source_at timestamptz not null,
  purpose text not null check (purpose in ('migration','new_branch','start_tracking','opening_cost')),
  reason text not null,
  file_name text,
  request jsonb not null,
  rows jsonb not null,
  total_value numeric(18,4) not null
);
alter table public.inventory_opening_batches enable row level security;
create policy inventory_opening_batches_read on public.inventory_opening_batches
  for select to authenticated using (
    tenant_id = (select tenant_id from public.profiles where id = auth.uid() and coalesce(is_active,true))
    and public.user_has_branch_access(auth.uid(),branch_id)
    and public.user_has_permission(auth.uid(),'inventory.adjust')
  );
revoke all on public.inventory_opening_batches from public, anon, authenticated;
grant select on public.inventory_opening_batches to authenticated;

create function public.preview_inventory_opening_00442(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid(); v_tenant uuid; v_branch uuid; v_code text;
  v_row jsonb; v_product public.products%rowtype; v_quantity numeric;
  v_cost numeric; v_target numeric; v_price numeric; v_reserved numeric;
  v_latest uuid; v_cost_latest uuid; v_fnb boolean; v_cascade text;
  v_result jsonb := '[]'; v_ids uuid[] := '{}'; v_events boolean;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(v_actor,'inventory.adjust') then
    raise exception 'OPENING_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' then raise exception 'OPENING_ROWS_REQUIRED'; end if;
  if jsonb_array_length(p_rows) not between 1 and 1000 then raise exception 'OPENING_ROWS_LIMIT'; end if;
  v_code := p_rows->0->>'branchCode';
  select id,cascade_mode into v_branch,v_cascade from public.branches where tenant_id=v_tenant and code=v_code;
  if v_branch is null or not public.user_has_branch_access(v_actor,v_branch) then
    raise exception 'OPENING_BRANCH_DENIED' using errcode='42501';
  end if;
  if coalesce((public.get_tenant_setting(v_tenant,'inventory_lock','{"locked":false}'::jsonb)->>'locked')::boolean,false) then
    raise exception 'INVENTORY_LOCKED';
  end if;
  v_fnb := public._fnb_branch_cost_tracking_enabled_00390(v_tenant,v_branch);
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if v_row->>'branchCode' is distinct from v_code then raise exception 'OPENING_ONE_BRANCH_REQUIRED'; end if;
    select * into v_product from public.products where tenant_id=v_tenant and code=v_row->>'productCode';
    if not found then raise exception 'OPENING_PRODUCT_NOT_FOUND: %',v_row->>'productCode'; end if;
    if v_product.id=any(v_ids) then raise exception 'OPENING_DUPLICATE_PRODUCT: %',v_product.code; end if;
    v_ids:=array_append(v_ids,v_product.id);
    if v_product.inventory_role='fnb_menu_item' or (v_product.product_type='sku' and v_product.channel='fnb')
      or (coalesce(v_product.has_bom,false) and v_cascade='production') then
      raise exception 'OPENING_STOCK_COMPONENT_REQUIRED: %',v_product.code;
    end if;
    if nullif(trim(v_row->>'unit'),'') is not null and trim(v_row->>'unit') is distinct from v_product.unit then
      raise exception 'OPENING_UNIT_MISMATCH: % (%)',v_product.code,v_product.unit;
    end if;
    v_target:=(v_row->>'quantity')::numeric; v_price:=(v_row->>'costPrice')::numeric;
    if v_target is null or v_price is null or v_target<0 or v_price<0
      or v_target::text in ('NaN','Infinity','-Infinity') or v_price::text in ('NaN','Infinity','-Infinity')
      or v_target<>round(v_target,4) or v_price<>round(v_price,6) then raise exception 'OPENING_NUMBER_INVALID: %',v_product.code; end if;
    select coalesce(quantity,0),coalesce(reserved,0) into v_quantity,v_reserved from public.branch_stock
      where tenant_id=v_tenant and branch_id=v_branch and product_id=v_product.id and variant_id is null;
    v_quantity:=coalesce(v_quantity,0); v_reserved:=coalesce(v_reserved,0);
    if v_quantity=0 and v_target>0 and exists(select 1 from public.product_lots
      where tenant_id=v_tenant and branch_id=v_branch and product_id=v_product.id and variant_id is null and current_qty>0) then
      raise exception 'OPENING_LOT_MISMATCH: %',v_product.code;
    end if;
    if v_reserved<>0 then raise exception 'OPENING_RESERVED_STOCK: %',v_product.code; end if;
    select id into v_latest from public.stock_movements where tenant_id=v_tenant and branch_id=v_branch and product_id=v_product.id
      order by created_at desc,id desc limit 1;
    -- Existing positive quantities can receive their missing opening value;
    -- quantity corrections belong in stocktakes, preserving the old ledger.
    if v_quantity<>0 and v_quantity<>v_target then raise exception 'OPENING_USE_STOCKTAKE: %',v_product.code; end if;
    if v_quantity=0 and exists(select 1 from public.stock_movements where tenant_id=v_tenant and branch_id=v_branch
      and product_id=v_product.id and reference_type not in ('initial_stock_opening','initial_stock_reset','initial_stock_import'))
      and v_target<>0 then raise exception 'OPENING_USE_STOCKTAKE: %',v_product.code; end if;
    v_cost_latest:=null; v_events:=false; v_cost:=coalesce(v_product.cost_price,0);
    if v_fnb then
      select id into v_cost_latest from public.fnb_branch_product_cost_events
        where tenant_id=v_tenant and branch_id=v_branch and product_id=v_product.id order by created_at desc,id desc limit 1;
      v_events:=v_cost_latest is not null;
      select unit_cost into v_cost from public.fnb_branch_product_cost_balances
        where tenant_id=v_tenant and branch_id=v_branch and product_id=v_product.id;
      if v_events and (v_target<>v_quantity or v_price is distinct from v_cost or not exists(
        select 1 from public.fnb_branch_product_cost_balances where tenant_id=v_tenant and branch_id=v_branch
        and product_id=v_product.id and costed_quantity=v_quantity)) then
        raise exception 'OPENING_COST_ALREADY_TRACKED: %',v_product.code;
      end if;
    elsif v_price<>coalesce(v_product.cost_price,0) and exists(select 1 from public.branch_stock
      where tenant_id=v_tenant and product_id=v_product.id and branch_id<>v_branch and quantity<>0) then
      raise exception 'OPENING_SHARED_COST_CONFLICT: %',v_product.code;
    end if;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'productId',v_product.id,'productCode',v_product.code,'productName',v_product.name,'unit',v_product.unit,
      'branchId',v_branch,'branchCode',v_code,'quantityBefore',v_quantity,'quantity',v_target,'costPrice',v_price,
      'costBefore',v_cost,'delta',v_target-v_quantity,'value',round(v_target*v_price,4),
      'latestMovement',v_latest,'latestCost',v_cost_latest,'costTracked',v_events,'fnb',v_fnb,'note',v_row->>'note',
      'lotNumber',nullif(trim(v_row->>'lotNumber'),''),'expiryDate',nullif(v_row->>'expiryDate','')::date));
  end loop;
  return v_result;
end; $$;

create function public.commit_inventory_opening_00442(
  p_batch_id uuid,p_rows jsonb,p_preview jsonb,p_purpose text,p_source_at timestamptz,p_reason text,p_file_name text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor uuid:=auth.uid(); v_tenant uuid; v_branch uuid; v_preview jsonb; v_row jsonb;
  v_existing public.inventory_opening_batches%rowtype; v_request jsonb;
  v_movement uuid; v_total numeric:=0;
begin
  select tenant_id into v_tenant from public.profiles where id=v_actor and coalesce(is_active,true);
  if v_tenant is null or not public.user_has_permission(v_actor,'inventory.adjust') then
    raise exception 'OPENING_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_batch_id is null or p_source_at is null or p_source_at>now()+interval '5 minutes'
    or p_purpose not in ('migration','new_branch','start_tracking','opening_cost') or p_purpose is null
    or nullif(trim(p_reason),'') is null or length(p_reason)>500 then raise exception 'OPENING_CONTEXT_REQUIRED'; end if;
  v_request:=jsonb_build_object('rows',p_rows,'preview',p_preview,'purpose',p_purpose,'source_at',p_source_at,'reason',trim(p_reason),'file_name',p_file_name);
  perform pg_advisory_xact_lock(hashtextextended(p_batch_id::text,442));
  select * into v_existing from public.inventory_opening_batches where id=p_batch_id;
  if found then
    if v_existing.tenant_id<>v_tenant or v_existing.created_by<>v_actor or v_existing.request<>v_request
      or not public.user_has_branch_access(v_actor,v_existing.branch_id) then raise exception 'OPENING_REPLAY_CONFLICT'; end if;
    return jsonb_build_object('id',p_batch_id,'count',jsonb_array_length(v_existing.rows),'totalValue',v_existing.total_value,'replayed',true);
  end if;
  -- Product rows serialize missing branch rows as well. Existing warehouse
  -- stock writers also lock these products; any deadlock rolls back safely.
  perform 1 from public.products where tenant_id=v_tenant and code in(select value->>'productCode' from jsonb_array_elements(p_rows))
    order by id for update;
  perform 1 from public.branch_stock where tenant_id=v_tenant and branch_id=(p_preview->0->>'branchId')::uuid
    and product_id in(select (value->>'productId')::uuid from jsonb_array_elements(p_preview)) order by product_id for update;
  perform 1 from public.fnb_branch_product_cost_balances where tenant_id=v_tenant and branch_id=(p_preview->0->>'branchId')::uuid
    and product_id in(select (value->>'productId')::uuid from jsonb_array_elements(p_preview)) order by product_id for update;
  v_preview:=public.preview_inventory_opening_00442(p_rows);
  if p_preview is null or v_preview<>p_preview then raise exception 'OPENING_PREVIEW_CHANGED'; end if;
  if p_purpose='opening_cost' and exists(select 1 from jsonb_array_elements(v_preview) r
    where (r->>'delta')::numeric<>0 or (r->>'quantity')::numeric<=0) then raise exception 'OPENING_CONTEXT_REQUIRED'; end if;
  v_branch:=(v_preview->0->>'branchId')::uuid;
  for v_row in select value from jsonb_array_elements(v_preview) loop
    v_movement:=null;
    if (v_row->>'delta')::numeric<>0 then
      perform public.upsert_branch_stock(v_tenant,v_branch,(v_row->>'productId')::uuid,(v_row->>'delta')::numeric);
      perform public.increment_product_stock((v_row->>'productId')::uuid,(v_row->>'delta')::numeric);
      insert into public.stock_movements(tenant_id,branch_id,product_id,type,quantity,unit_cost,reference_type,reference_id,note,created_by)
      values(v_tenant,v_branch,(v_row->>'productId')::uuid,'in',(v_row->>'delta')::numeric,(v_row->>'costPrice')::numeric,
        'initial_stock_opening',p_batch_id,trim(p_reason),v_actor) returning id into v_movement;
      insert into public.product_lots(tenant_id,branch_id,product_id,lot_number,source_type,received_date,expiry_date,
        initial_qty,current_qty,status,note)
      values(v_tenant,v_branch,(v_row->>'productId')::uuid,coalesce(v_row->>'lotNumber','TDK-'||p_batch_id::text||'-'||(v_row->>'productCode')),
        'opening',current_date,(v_row->>'expiryDate')::date,(v_row->>'delta')::numeric,(v_row->>'delta')::numeric,
        case when (v_row->>'expiryDate')::date<current_date then 'expired' else 'active' end,trim(p_reason));
    end if;
    if (v_row->>'fnb')::boolean then
      if not (v_row->>'costTracked')::boolean and (v_row->>'quantity')::numeric>0 then
        perform public._post_fnb_branch_cost_in_00390(v_tenant,v_branch,(v_row->>'productId')::uuid,
          (v_row->>'quantity')::numeric,(v_row->>'costPrice')::numeric,'opening','initial_stock_opening',p_batch_id,v_movement,trim(p_reason),v_actor);
        update public.fnb_branch_product_cost_balances set opening_cost_confirmed=true
          where tenant_id=v_tenant and branch_id=v_branch and product_id=(v_row->>'productId')::uuid;
      end if;
    else
      update public.products set cost_price=(v_row->>'costPrice')::numeric where tenant_id=v_tenant and id=(v_row->>'productId')::uuid;
    end if;
    v_total:=v_total+(v_row->>'value')::numeric;
  end loop;
  insert into public.inventory_opening_batches(id,tenant_id,branch_id,created_by,source_at,purpose,reason,file_name,request,rows,total_value)
    values(p_batch_id,v_tenant,v_branch,v_actor,p_source_at,p_purpose,trim(p_reason),p_file_name,v_request,v_preview,v_total);
  insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
    values(v_tenant,v_actor,'inventory_opening','inventory_opening_batch',p_batch_id,jsonb_build_object('branch_id',v_branch,'rows',v_preview,'total_value',v_total,'source_at',p_source_at));
  return jsonb_build_object('id',p_batch_id,'count',jsonb_array_length(v_preview),'totalValue',v_total,'replayed',false);
end; $$;
revoke all on function public.preview_inventory_opening_00442(jsonb),public.commit_inventory_opening_00442(uuid,jsonb,jsonb,text,timestamptz,text,text) from public,anon;
grant execute on function public.preview_inventory_opening_00442(jsonb),public.commit_inventory_opening_00442(uuid,jsonb,jsonb,text,timestamptz,text,text) to authenticated;
-- Existing application installations have this authenticated legacy RPC. A
-- stale browser must reload rather than write an opening row without preview.
do $guard$
declare definition text;
begin
  if to_regprocedure('public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)') is not null then
    definition:=pg_get_functiondef('public.apply_manual_stock_movement_atomic(uuid,uuid,uuid,jsonb)'::regprocedure);
    if position('OPENING_WORKFLOW_REQUIRED' in definition)=0 then
      if position('v_reference_type := nullif(v_item->>''reference_type'', '''');' in definition)=0 then
        raise exception 'OPENING_LEGACY_GUARD_BOUNDARY_CHANGED';
      end if;
      definition:=replace(definition,'v_reference_type := nullif(v_item->>''reference_type'', '''');',
        E'v_reference_type := nullif(v_item->>''reference_type'', '''');\n    if v_reference_type = ''initial_stock_reset'' then raise exception ''OPENING_WORKFLOW_REQUIRED''; end if;');
      execute definition;
    end if;
  end if;
end $guard$;
notify pgrst,'reload schema';
commit;
