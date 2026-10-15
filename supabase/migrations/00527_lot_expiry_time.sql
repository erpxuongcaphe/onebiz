-- Exact optional expiry time. Existing date-only lots and all inventory quantities stay unchanged.
alter table public.product_lots add column if not exists expiry_at timestamptz;
alter table public.purchase_order_items add column if not exists expiry_at timestamptz;
comment on column public.product_lots.expiry_at is 'Optional exact expiry instant; expiry_date remains the Vietnam calendar date. NULL preserves date-only expiry.';

create or replace function public._parse_expiry_time_00527(p_value text)
returns timestamptz language plpgsql immutable set search_path='' as $$
begin
 if p_value is null or btrim(p_value)='' or p_value ~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
 if p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}' then raise exception 'EXPIRY_TIME_INVALID';end if;
 if p_value ~ '(Z|[+-]\d{2}:?\d{2})$' then return p_value::timestamptz;end if;
 return p_value::timestamp at time zone 'Asia/Ho_Chi_Minh';
end $$;

create or replace function public._lot_expiry_moment_00527(p_date date,p_at timestamptz)
returns timestamptz language sql immutable set search_path='' as $$
 select coalesce(p_at,(p_date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
$$;

-- Transaction-local transport preserves the original save RPCs, permissions and replay hashes.
create or replace function public._lot_expiry_context_00527(p_rows jsonb,p_branch uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); tenant uuid; item jsonb; product uuid; branch uuid; expires timestamptz; result jsonb:='[]';
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null then raise exception 'ACTIVE_PROFILE_REQUIRED' using errcode='42501';end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' then return result;end if;
 for item in select value from jsonb_array_elements(p_rows) loop
  expires:=public._parse_expiry_time_00527(coalesce(item->>'expiry_date',item->>'expiryDate'));
  if expires is null then continue;end if;
  product:=coalesce(nullif(item->>'product_id',''),nullif(item->>'productId',''))::uuid;
  if product is null then select id into product from products where tenant_id=tenant and code=item->>'productCode';end if;
  branch:=coalesce(p_branch,coalesce(nullif(item->>'branch_id',''),nullif(item->>'branchId',''))::uuid);
  if branch is null then select id into branch from branches where tenant_id=tenant and code=item->>'branchCode';end if;
  if product is null or branch is null or not exists(select 1 from products where id=product and tenant_id=tenant)
   or not public.user_has_branch_access(actor,branch) then raise exception 'EXPIRY_SCOPE_DENIED' using errcode='42501';end if;
  if exists(select 1 from jsonb_array_elements(result) r where r->>'productId'=product::text and r->>'branchId'=branch::text and (r->>'expiryAt')::timestamptz<>expires) then raise exception 'EXPIRY_LINES_AMBIGUOUS';end if;
  result:=result||jsonb_build_array(jsonb_build_object('productId',product,'branchId',branch,'expiryAt',expires));
 end loop;
 return result;
end $$;

create or replace function public._preserve_lot_expiry_00527()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare context jsonb; branch uuid; tenant uuid; exact_time timestamptz; distinct_times integer;
begin
 if tg_op='UPDATE' and new.expiry_date is distinct from old.expiry_date and new.expiry_at is not distinct from old.expiry_at then
  new.expiry_at:=null;
 end if;
 if tg_table_name='product_lots' then branch:=new.branch_id;tenant:=new.tenant_id;
 else select branch_id,tenant_id into branch,tenant from purchase_orders where id=new.purchase_order_id;end if;
 context:=coalesce(nullif(current_setting('onebiz.lot_expiry_context',true),''),'[]')::jsonb;
 select max((r->>'expiryAt')::timestamptz) into exact_time from jsonb_array_elements(context) r
 where r->>'productId'=new.product_id::text and r->>'branchId'=branch::text;
 if exact_time is not null then new.expiry_at:=exact_time;end if;
 if tg_table_name='product_lots' and tg_op='INSERT' and new.expiry_at is null then
  -- Later partial receipts inherit the hour already saved on the corresponding PO line.
  if new.purchase_order_id is not null then
   select count(distinct i.expiry_at),max(i.expiry_at) into distinct_times,exact_time from purchase_order_items i
   where i.purchase_order_id=new.purchase_order_id and i.product_id=new.product_id and i.expiry_date is not distinct from new.expiry_date;
   if distinct_times>1 then raise exception 'EXPIRY_LINES_AMBIGUOUS';end if;
   new.expiry_at:=exact_time;
  elsif new.production_order_id is not null then
   select count(distinct l.expiry_at),max(l.expiry_at) into distinct_times,exact_time from product_lots l
   where l.tenant_id=tenant and l.product_id=new.product_id and l.production_order_id=new.production_order_id and l.expiry_date is not distinct from new.expiry_date;
   if distinct_times>1 then raise exception 'EXPIRY_LINES_AMBIGUOUS';end if;
   new.expiry_at:=exact_time;
  end if;
 end if;
 if new.expiry_at is not null then
  if new.expiry_date is not null and new.expiry_date<>(new.expiry_at at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'EXPIRY_DATE_TIME_MISMATCH';end if;
  new.expiry_date:=(new.expiry_at at time zone 'Asia/Ho_Chi_Minh')::date;
 end if;
 return new;
end $$;
create trigger preserve_lot_expiry_time_00527 before insert or update of expiry_date,expiry_at on public.product_lots
 for each row execute function public._preserve_lot_expiry_00527();
create trigger preserve_purchase_expiry_time_00527 before insert or update of expiry_date,expiry_at on public.purchase_order_items
 for each row execute function public._preserve_lot_expiry_00527();

-- Keep JSON save signatures intact; do not rewrite any inventory/accounting implementation.
do $$
declare entry record; fn record; original_name text; arg_call text; context_sql text;
begin
 for entry in select * from (values
  ('save_purchase_order_with_uom_atomic','_expiry_po_base_00527','p_items','p_branch_id'),
  ('save_purchase_order_with_uom_atomic_v2','_expiry_po_v2_base_00527','p_items','p_branch_id'),
  ('bulk_create_adjustment_lots_atomic','_expiry_bulk_base_00527','p_items','null::uuid'),
  ('commit_inventory_opening_00442','_expiry_opening_base_00527','p_rows','null::uuid')
 ) v(name,base_name,items_arg,branch_arg) loop
  select p.oid,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args,p.proargnames into strict fn
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=entry.name and p.prorettype='jsonb'::regtype;
  select string_agg(quote_ident(arg),',') into arg_call from unnest(fn.proargnames) arg;
  execute format('alter function public.%I(%s) rename to %I',entry.name,fn.identity_args,entry.base_name);
  execute format('revoke all on function public.%I(%s) from public,anon,authenticated',entry.base_name,fn.identity_args);
  context_sql:=format('public._lot_expiry_context_00527(%s,%s)',entry.items_arg,entry.branch_arg);
  execute format($wrapper$
   create function public.%I(%s) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $body$
   declare previous text:=current_setting('onebiz.lot_expiry_context',true); result jsonb;
   begin
    perform set_config('onebiz.lot_expiry_context',(%s)::text,true);
    result:=public.%I(%s);
    perform set_config('onebiz.lot_expiry_context',coalesce(previous,''),true);
    return result;
   end $body$
  $wrapper$,entry.name,fn.args,context_sql,entry.base_name,arg_call);
  execute format('revoke all on function public.%I(%s) from public,anon',entry.name,fn.identity_args);
  execute format('grant execute on function public.%I(%s) to authenticated',entry.name,fn.identity_args);
 end loop;
end $$;

create or replace function public.complete_production_with_expiry_time(
 p_production_order_id uuid,p_completed_qty numeric,p_expiry_value text,
 p_lot_number text default null,p_manufactured_date date default current_date,
 p_input_quantity numeric default null,p_input_unit text default null,p_expected_factor numeric default null,p_material_inputs jsonb default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid;po record;lot uuid;expires timestamptz;day date;previous text:=current_setting('onebiz.lot_expiry_context',true);replay boolean;
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not public.user_has_permission(actor,'production.complete_order') then raise exception 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED' using errcode='42501';end if;
 select * into po from production_orders where id=p_production_order_id and tenant_id=tenant for update;
 if not found or not public.user_has_branch_access(actor,po.branch_id) then raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 expires:=public._parse_expiry_time_00527(p_expiry_value);
 day:=case when expires is not null then (expires at time zone 'Asia/Ho_Chi_Minh')::date else nullif(p_expiry_value,'')::date end;
 replay:=po.status='completed' or exists(select 1 from operational_uom_requests where reference_type='production' and request_id=po.id);
 perform set_config('onebiz.lot_expiry_context',jsonb_build_array(jsonb_build_object('productId',po.product_id,'branchId',po.branch_id,'expiryAt',expires))::text,true);
 if p_input_unit is not null then
  lot:=public.complete_production_with_uom(po.id,p_input_quantity,p_input_unit,p_expected_factor,p_lot_number,p_manufactured_date,day,p_material_inputs);
 else
  lot:=public.complete_production_atomic(po.id,p_completed_qty,p_lot_number,p_manufactured_date,day);
 end if;
 if replay and exists(select 1 from product_lots where id=lot and expiry_at is distinct from expires) then raise exception 'EXPIRY_REPLAY_CHANGED';end if;
 if not replay then update product_lots set expiry_at=expires where id=lot and tenant_id=tenant;end if;
 perform set_config('onebiz.lot_expiry_context',coalesce(previous,''),true);
 return lot;
end $$;
revoke all on function public.complete_production_with_expiry_time(uuid,numeric,text,text,date,numeric,text,numeric,jsonb) from public,anon;
grant execute on function public.complete_production_with_expiry_time(uuid,numeric,text,text,date,numeric,text,numeric,jsonb) to authenticated;
revoke all on function public._parse_expiry_time_00527(text),public._lot_expiry_context_00527(jsonb,uuid),public._preserve_lot_expiry_00527() from public,anon,authenticated;
-- Read helpers expose no data and are used by existing invoker report functions.
grant execute on function public._lot_expiry_moment_00527(date,timestamptz) to authenticated;

notify pgrst,'reload schema';

-- Existing authorized lot reader, extended with optional exact hour.
create or replace function public.get_lots_for_product(p_product_id uuid,p_branch_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.get_user_tenant_id(); v_result jsonb;
begin
 if v_tenant is null or not public.user_has_permission(auth.uid(),'inventory.view') then raise exception 'LOT_READ_PERMISSION_DENIED' using errcode='42501';end if;
 if p_branch_id is not null and not public._can_read_branch_inventory_00476(auth.uid(),v_tenant,p_branch_id) then raise exception 'LOT_BRANCH_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',pl.id,'lot_number',pl.lot_number,'source_type',pl.source_type,
 'manufactured_date',pl.manufactured_date,'expiry_date',pl.expiry_date,'expiry_at',pl.expiry_at,'received_date',pl.received_date,
 'current_qty',pl.current_qty,'initial_qty',pl.initial_qty,'branch_name',b.name,
 'expiry_status',case when pl.expiry_date is null then 'no_expiry' when public._lot_expiry_moment_00527(pl.expiry_date,pl.expiry_at)<=now() then 'expired' when pl.expiry_date<current_date+30 then 'expiring_soon' else 'ok' end,
 'days_until_expiry',pl.expiry_date-current_date) order by pl.expiry_date asc nulls last,pl.received_date),'[]'::jsonb) into v_result
 from public.product_lots pl join public.branches b on b.id=pl.branch_id and b.tenant_id=pl.tenant_id
 where pl.tenant_id=v_tenant and pl.product_id=p_product_id and pl.status='active' and pl.current_qty>0
 and (p_branch_id is null or pl.branch_id=p_branch_id)
 and public._can_read_branch_inventory_00476(auth.uid(),v_tenant,pl.branch_id);
 return v_result;
end; $$;

-- Existing authorized lot reader, extended with optional exact hour.
create or replace function public.check_expiring_lots(p_tenant_id uuid,p_days_threshold integer default 30) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_lots jsonb;
begin
 if p_tenant_id is distinct from public.get_user_tenant_id() or not public.user_has_permission(auth.uid(),'inventory.view') then raise exception 'LOT_READ_PERMISSION_DENIED' using errcode='42501';end if;
 p_days_threshold:=least(greatest(coalesce(p_days_threshold,30),0),3650);
 select coalesce(jsonb_agg(jsonb_build_object('lot_id',pl.id,'lot_number',pl.lot_number,'product_id',pl.product_id,
 'product_name',p.name,'product_code',p.code,'expiry_date',pl.expiry_date,'expiry_at',pl.expiry_at,'current_qty',pl.current_qty,
 'branch_name',b.name,'days_remaining',pl.expiry_date-current_date,'is_expired',public._lot_expiry_moment_00527(pl.expiry_date,pl.expiry_at)<=now()) order by pl.expiry_date),'[]'::jsonb)
 into v_lots from public.product_lots pl join public.products p on p.id=pl.product_id and p.tenant_id=pl.tenant_id
 join public.branches b on b.id=pl.branch_id and b.tenant_id=pl.tenant_id
 where pl.tenant_id=p_tenant_id and pl.status='active' and pl.current_qty>0 and pl.expiry_date<=current_date+p_days_threshold
 and public._can_read_branch_inventory_00476(auth.uid(),p_tenant_id,pl.branch_id);
 return jsonb_build_object('threshold_days',p_days_threshold,'total',jsonb_array_length(v_lots),'lots',v_lots);
end; $$;

-- Existing authorized lot reader, extended with optional exact hour.
create or replace function public.get_product_lot_list_workspace(
  p_page integer default 0,
  p_page_size integer default 20,
  p_search text default null,
  p_search_field text default 'all',
  p_statuses text[] default null,
  p_source_types text[] default null,
  p_expiry_state text default 'all',
  p_threshold_days integer default 30,
  p_received_from date default null,
  p_received_to_exclusive date default null,
  p_branch_id uuid default null
) returns jsonb
language plpgsql stable security invoker
set search_path=public,pg_temp
as $$
declare
  v_actor uuid:=auth.uid();
  v_tenant uuid;
  v_all boolean;
  v_q text:=nullif(trim(coalesce(p_search,'')),'');
  v_page integer:=greatest(coalesce(p_page,0),0);
  v_size integer:=least(greatest(coalesce(p_page_size,20),1),200);
  v_threshold integer:=least(greatest(coalesce(p_threshold_days,30),1),365);
  v_today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_result jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='PRODUCT_LOT_LIST_AUTH_REQUIRED'; end if;
  v_tenant:=public.get_user_tenant_id();
  if v_tenant is null or not exists(
    select 1 from public.profiles p
    where p.id=v_actor and p.tenant_id=v_tenant and coalesce(p.is_active,true)
  ) then raise exception using errcode='42501',message='PRODUCT_LOT_LIST_PROFILE_DENIED'; end if;
  if not public.user_has_permission(v_actor,'inventory.view') then
    raise exception using errcode='42501',message='PRODUCT_LOT_LIST_PERMISSION_DENIED';
  end if;
  if coalesce(p_expiry_state,'all') not in ('all','attention','expired','upcoming','no_expiry') then
    raise exception using errcode='22023',message='PRODUCT_LOT_LIST_EXPIRY_STATE_INVALID';
  end if;
  v_all:=public.user_has_permission(v_actor,'reports.view_all_branches')
    or public.user_has_permission(v_actor,'system.manage_branches');
  if p_branch_id is not null and (
    not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant)
    or (not v_all and not public.user_has_branch_access(v_actor,p_branch_id))
  ) then raise exception using errcode='42501',message='PRODUCT_LOT_LIST_BRANCH_DENIED'; end if;

  with scoped as (
    select l.*,pr.name product_name,pr.code product_code,b.name branch_name,
      case when l.expiry_date is null then null else l.expiry_date-v_today end days_remaining
    from public.product_lots l
    join public.products pr on pr.id=l.product_id and pr.tenant_id=v_tenant
    join public.branches b on b.id=l.branch_id and b.tenant_id=v_tenant
    where l.tenant_id=v_tenant and (
      (p_branch_id is not null and l.branch_id=p_branch_id)
      or (p_branch_id is null and v_all)
      or (p_branch_id is null and not v_all and l.branch_id in(
        select x.branch_id from public.get_user_accessible_branches(v_actor)x
      ))
    )
  ), filtered as (
    select s.* from scoped s where
      (v_q is null or case coalesce(p_search_field,'all')
        when 'lot_number' then position(lower(v_q) in lower(coalesce(s.lot_number,'')))>0
        when 'product_code' then position(lower(v_q) in lower(coalesce(s.product_code,'')))>0
        when 'product_name' then position(lower(v_q) in lower(coalesce(s.product_name,'')))>0
        else position(lower(v_q) in lower(coalesce(s.lot_number,'')))>0
          or position(lower(v_q) in lower(coalesce(s.product_code,'')))>0
          or position(lower(v_q) in lower(coalesce(s.product_name,'')))>0 end)
      and (coalesce(array_length(p_statuses,1),0)=0 or s.status=any(p_statuses))
      and (coalesce(array_length(p_source_types,1),0)=0 or s.source_type=any(p_source_types))
      and (p_received_from is null or s.received_date>=p_received_from)
      and (p_received_to_exclusive is null or s.received_date<p_received_to_exclusive)
      and case coalesce(p_expiry_state,'all')
        when 'attention' then s.status='active' and s.current_qty>0 and s.expiry_date is not null and s.expiry_date<=v_today+v_threshold
        when 'expired' then s.current_qty>0 and s.expiry_date is not null and public._lot_expiry_moment_00527(s.expiry_date,s.expiry_at)<=now()
        when 'upcoming' then s.current_qty>0 and public._lot_expiry_moment_00527(s.expiry_date,s.expiry_at)>now() and s.expiry_date<=v_today+v_threshold
        when 'no_expiry' then s.expiry_date is null
        else true end
  ), ranked as (
    select f.*,row_number()over(order by f.created_at desc,f.id)rn from filtered f
  ), page_rows as (
    select * from ranked where rn>v_page*v_size and rn<=(v_page+1)*v_size order by rn
  ), summary as (
    select count(*)::bigint total_count,
      count(*)filter(where status='active')::bigint active_count,
      coalesce(sum(current_qty),0)::numeric current_qty,
      count(*)filter(where current_qty>0 and public._lot_expiry_moment_00527(expiry_date,expiry_at)<=now())::bigint expired_count,
      count(*)filter(where current_qty>0 and public._lot_expiry_moment_00527(expiry_date,expiry_at)>now() and expiry_date<=v_today+v_threshold)::bigint near_expiry_count
    from filtered
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(
      jsonb_build_object(
        'id',r.id,'tenant_id',r.tenant_id,'product_id',r.product_id,
        'product_name',r.product_name,'product_code',r.product_code,
        'lot_number',r.lot_number,'source_type',r.source_type,
        'production_order_id',r.production_order_id,'purchase_order_id',r.purchase_order_id,
        'manufactured_date',r.manufactured_date,'expiry_date',r.expiry_date,'expiry_at',r.expiry_at,
        'received_date',r.received_date,'initial_qty',r.initial_qty,'current_qty',r.current_qty,
        'branch_id',r.branch_id,'branch_name',r.branch_name,'status',r.status,
        'note',r.note,'created_at',r.created_at,'updated_at',r.updated_at,
        'days_remaining',r.days_remaining
      ) order by r.rn)from page_rows r),'[]'::jsonb),
    'total',(select total_count from summary),
    'summary',(select jsonb_build_object(
      'activeCount',active_count,'currentQty',current_qty,
      'expiredCount',expired_count,'nearExpiryCount',near_expiry_count
    )from summary)
  ) into v_result;
  return v_result;
end $$;
