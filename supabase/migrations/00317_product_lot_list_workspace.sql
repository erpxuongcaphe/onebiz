-- 00317: One read-only workspace for production lots and expiry alerts.
-- This migration does not change business rows, stock quantities, documents,
-- tables, columns, constraints, triggers, policies, or indexes.

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
        when 'expired' then s.current_qty>0 and s.expiry_date is not null and s.expiry_date<v_today
        when 'upcoming' then s.current_qty>0 and s.expiry_date between v_today and v_today+v_threshold
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
      count(*)filter(where current_qty>0 and expiry_date<v_today)::bigint expired_count,
      count(*)filter(where current_qty>0 and expiry_date between v_today and v_today+v_threshold)::bigint near_expiry_count
    from filtered
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(
      jsonb_build_object(
        'id',r.id,'tenant_id',r.tenant_id,'product_id',r.product_id,
        'product_name',r.product_name,'product_code',r.product_code,
        'lot_number',r.lot_number,'source_type',r.source_type,
        'production_order_id',r.production_order_id,'purchase_order_id',r.purchase_order_id,
        'manufactured_date',r.manufactured_date,'expiry_date',r.expiry_date,
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

comment on function public.get_product_lot_list_workspace(integer,integer,text,text,text[],text[],text,integer,date,date,uuid)
  is 'Read-only, tenant and branch scoped workspace for lot and expiry lists.';
revoke all on function public.get_product_lot_list_workspace(integer,integer,text,text,text[],text[],text,integer,date,date,uuid) from public;
grant execute on function public.get_product_lot_list_workspace(integer,integer,text,text,text[],text[],text,integer,date,date,uuid) to authenticated;
notify pgrst,'reload schema';

select to_regprocedure('public.get_product_lot_list_workspace(integer,integer,text,text,text[],text[],text,integer,date,date,uuid)')is not null as product_lot_workspace_rpc_ok;
