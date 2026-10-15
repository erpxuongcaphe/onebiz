-- Optional production clock times. Legacy calendar dates, stock and BOM rows remain untouched.
alter table public.production_orders add column planned_start_at timestamptz, add column planned_end_at timestamptz;
alter table public.product_lots add column manufactured_at timestamptz;

create function public._production_time_00528(p_value text) returns timestamptz
language plpgsql immutable set search_path='' as $$
declare result timestamptz;
begin
 if p_value is null or btrim(p_value)='' then return null;end if;
 if p_value ~ '^\d{4}-\d{2}-\d{2}$' then perform p_value::date;return null;end if;
 if p_value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$' then raise exception 'PRODUCTION_TIME_INVALID';end if;
 result:=case when p_value ~ '(Z|[+-]\d{2}:?\d{2})$' then p_value::timestamptz else p_value::timestamp at time zone 'Asia/Ho_Chi_Minh' end;
 return result;
end $$;
revoke all on function public._production_time_00528(text) from public,anon,authenticated;

-- Delegate to the original tenant/branch/BOM/quantity guards. Only the dates are normalized.
alter function public.create_production_order_atomic(jsonb) rename to _production_create_base_00528;
revoke all on function public._production_create_base_00528(jsonb) from public,anon,authenticated;
create function public.create_production_order_atomic(p_input jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare start_at timestamptz;end_at timestamptz;payload jsonb:=p_input;result jsonb;start_day date;end_day date;
begin
 start_at:=public._production_time_00528(p_input->>'planned_start');
 end_at:=public._production_time_00528(p_input->>'planned_end');
 start_day:=case when start_at is null then nullif(p_input->>'planned_start','')::date else (start_at at time zone 'Asia/Ho_Chi_Minh')::date end;
 end_day:=case when end_at is null then nullif(p_input->>'planned_end','')::date else (end_at at time zone 'Asia/Ho_Chi_Minh')::date end;
 if (start_at is not null and end_at is not null and end_at<start_at) or end_day<start_day then raise exception 'PRODUCTION_DATE_RANGE_INVALID';end if;
 payload:=payload||jsonb_build_object('planned_start',start_day,'planned_end',end_day);
 result:=public._production_create_base_00528(payload);
 update public.production_orders set planned_start_at=start_at,planned_end_at=end_at
 where id=(result->>'id')::uuid and tenant_id=public.get_user_tenant_id();
 return result;
end $$;
revoke all on function public.create_production_order_atomic(jsonb) from public,anon;
grant execute on function public.create_production_order_atomic(jsonb) to authenticated;

-- Complete once through the proven atomic/UOM/expiry chain; an error rolls back stock and time together.
create function public.complete_production_with_date_times(
 p_production_order_id uuid,p_completed_qty numeric,p_manufactured_value text default null,p_expiry_value text default null,
 p_lot_number text default null,p_input_quantity numeric default null,p_input_unit text default null,
 p_expected_factor numeric default null,p_material_inputs jsonb default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid();tenant uuid;po record;lot uuid;made_at timestamptz;made_day date;expires timestamptz;replay boolean;
begin
 select tenant_id into tenant from profiles where id=actor and coalesce(is_active,true);
 if tenant is null or not public.user_has_permission(actor,'production.complete_order') then raise exception 'COMPLETE_PRODUCTION_ORDER_PERMISSION_REQUIRED' using errcode='42501';end if;
 select * into po from production_orders where id=p_production_order_id and tenant_id=tenant for update;
 if not found or not public.user_has_branch_access(actor,po.branch_id) then raise exception 'PRODUCTION_BRANCH_ACCESS_DENIED' using errcode='42501';end if;
 made_at:=public._production_time_00528(p_manufactured_value);
 made_day:=case when made_at is not null then (made_at at time zone 'Asia/Ho_Chi_Minh')::date else coalesce(nullif(p_manufactured_value,'')::date,(now() at time zone 'Asia/Ho_Chi_Minh')::date) end;
 expires:=public._production_time_00528(p_expiry_value);
 if (made_at is not null and expires is not null and expires<made_at)
 or coalesce((expires at time zone 'Asia/Ho_Chi_Minh')::date,nullif(p_expiry_value,'')::date)<made_day then raise exception 'PRODUCTION_LOT_DATE_RANGE_INVALID';end if;
 replay:=po.status='completed' or exists(select 1 from operational_uom_requests where reference_type='production' and request_id=po.id);
 lot:=public.complete_production_with_expiry_time(po.id,p_completed_qty,p_expiry_value,p_lot_number,made_day,p_input_quantity,p_input_unit,p_expected_factor,p_material_inputs);
 if replay and exists(select 1 from product_lots where id=lot and (manufactured_at is distinct from made_at or manufactured_date is distinct from made_day)) then raise exception 'PRODUCTION_TIME_REPLAY_CHANGED';end if;
 if not replay then update product_lots set manufactured_at=made_at where id=lot and tenant_id=tenant;end if;
 return lot;
end $$;
revoke all on function public.complete_production_with_date_times(uuid,numeric,text,text,text,numeric,text,numeric,jsonb) from public,anon;
grant execute on function public.complete_production_with_date_times(uuid,numeric,text,text,text,numeric,text,numeric,jsonb) to authenticated;

-- Append columns to scoped projections without changing their original predicates/options/grants.
do $$
declare item record;definition text;
begin
 for item in select * from (values
 ('production_orders_scoped','production_orders','p.planned_start_at,p.planned_end_at'),
 ('product_lots_scoped','product_lots','p.manufactured_at')
 )x(view_name,table_name,columns) loop
  if to_regclass('public.'||item.view_name) is not null then
   definition:=trim(trailing ';' from pg_get_viewdef(('public.'||item.view_name)::regclass,true));
   execute format('create or replace view public.%I as select v.*,%s from (%s) v join public.%I p on p.id=v.id and p.tenant_id=v.tenant_id',item.view_name,item.columns,definition,item.table_name);
  end if;
 end loop;
 -- Existing list workspace uses to_jsonb on the scoped projection and receives new columns automatically.
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('get_lots_for_product','get_product_lot_list_workspace') loop
  definition:=pg_get_functiondef(item.oid);
  if position('''manufactured_date'',pl.manufactured_date' in definition)>0 then
   definition:=replace(definition,'''manufactured_date'',pl.manufactured_date','''manufactured_at'',pl.manufactured_at,''manufactured_date'',pl.manufactured_date');
  elsif position('''manufactured_date'',r.manufactured_date' in definition)>0 then
   definition:=replace(definition,'''manufactured_date'',r.manufactured_date','''manufactured_at'',r.manufactured_at,''manufactured_date'',r.manufactured_date');
  else raise exception 'PRODUCTION_LOT_READER_CHANGED';end if;
  execute definition;
 end loop;
end $$;

notify pgrst,'reload schema';
