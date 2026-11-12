-- A stock operator needs the quantities on their own work documents, but that
-- action alone must not expose the unit costs stored in the underlying rows.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.get_stock_work_document_detail(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; branch uuid; result jsonb; show_cost boolean; member boolean; can_view boolean;
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if tenant is null then raise exception 'STOCK_WORK_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_kind='disposal_export' then
  select d.branch_id into branch from public.disposal_exports d where d.id=p_id and d.tenant_id=tenant;
 elsif p_kind='internal_export' then
  select d.branch_id into branch from public.internal_exports d where d.id=p_id and d.tenant_id=tenant;
 else raise exception 'STOCK_WORK_KIND_INVALID' using errcode='22023'; end if;
 member:=coalesce(public.user_has_branch_access(actor,branch),false);
 can_view:=(member or coalesce(public.user_has_permission(actor,'reports.view_all_branches'),false))
   and coalesce(public._staff_inventory_row_visible(branch),false) and coalesce(public._staff_my_inventory_view(branch),false);
 if branch is null or not (can_view or (member and
   public._staff_permission_at_scope(actor,case when p_kind='disposal_export' then 'inventory.dispose' else 'inventory.internal_export' end,branch)))
 then raise exception 'STOCK_WORK_DOCUMENT_DENIED' using errcode='42501'; end if;
 show_cost:=coalesce(public.user_has_permission(actor,'products.view_cost'),false) and not exists(
  select 1 from public.user_permission_overrides o where o.tenant_id=tenant and o.user_id=actor
   and o.permission_code='products.view_cost' and o.override_type='revoke');
 if p_kind='disposal_export' then
  select jsonb_build_object('id',d.id,'branchId',d.branch_id,'code',d.code,'status',d.status,
   'createdAt',d.created_at,'createdBy',d.created_by,'reason',d.reason,'note',d.note,
   'branchName',(select b.name from public.branches b where b.id=d.branch_id and b.tenant_id=tenant),
   'createdByName',(select p.full_name from public.profiles p where p.id=d.created_by and p.tenant_id=tenant),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'productId',i.product_id,
     'productName',i.product_name,'productCode',p.code,'unit',i.unit,'quantity',i.quantity) ||
     case when show_cost then jsonb_build_object('unitPrice',i.unit_price,'amount',i.total) else '{}'::jsonb end order by i.id)
     from public.disposal_export_items i left join public.products p on p.id=i.product_id and p.tenant_id=tenant where i.disposal_id=d.id),'[]'::jsonb))
   || case when show_cost then jsonb_build_object('totalAmount',d.total_amount) else '{}'::jsonb end
   into result from public.disposal_exports d where d.id=p_id and d.tenant_id=tenant;
 else
  select jsonb_build_object('id',d.id,'branchId',d.branch_id,'code',d.code,'status',d.status,
   'createdAt',d.created_at,'createdBy',d.created_by,'department',d.department,'note',d.note,
   'branchName',(select b.name from public.branches b where b.id=d.branch_id and b.tenant_id=tenant),
   'createdByName',(select p.full_name from public.profiles p where p.id=d.created_by and p.tenant_id=tenant),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'productId',i.product_id,
     'productName',i.product_name,'productCode',p.code,'unit',i.unit,'quantity',i.quantity) ||
     case when show_cost then jsonb_build_object('unitPrice',i.unit_price,'amount',i.total) else '{}'::jsonb end order by i.id)
     from public.internal_export_items i left join public.products p on p.id=i.product_id and p.tenant_id=tenant where i.export_id=d.id),'[]'::jsonb))
   || case when show_cost then jsonb_build_object('totalAmount',d.total_amount) else '{}'::jsonb end
   into result from public.internal_exports d where d.id=p_id and d.tenant_id=tenant;
 end if;
 return result;
end $$;
revoke all on function public.get_stock_work_document_detail(text,uuid) from public,anon;
grant execute on function public.get_stock_work_document_detail(text,uuid) to authenticated;

-- Quantity-only list for a person who can perform the stock action without
-- granting direct SELECT on the cost-bearing document tables.
create function public.get_stock_work_document_list(
 p_kind text,p_branch uuid default null,p_page integer default 0,p_page_size integer default 20,
 p_search text default null,p_search_field text default 'all',p_statuses text[] default null,
 p_from timestamptz default null,p_to timestamptz default null,p_created_by uuid default null,
 p_amount_min numeric default null,p_amount_max numeric default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid; code text; branches uuid[]; view_branches uuid[]; result jsonb; show_cost boolean;
 q text:=nullif(lower(trim(coalesce(p_search,''))), '');
 page_no integer:=greatest(coalesce(p_page,0),0); page_size integer:=least(greatest(coalesce(p_page_size,20),1),200);
begin
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,true);
 if tenant is null then raise exception 'STOCK_WORK_AUTH_REQUIRED' using errcode='42501'; end if;
 code:=case p_kind when 'disposal_export' then 'inventory.dispose' when 'internal_export' then 'inventory.internal_export' else null end;
 if code is null then raise exception 'STOCK_WORK_KIND_INVALID' using errcode='22023'; end if;
 show_cost:=coalesce(public.user_has_permission(actor,'products.view_cost'),false) and not exists(
  select 1 from public.user_permission_overrides o where o.tenant_id=tenant and o.user_id=actor
   and o.permission_code='products.view_cost' and o.override_type='revoke');
 select coalesce(array_agg(b.id),'{}'::uuid[]) into view_branches from public.branches b
  where b.tenant_id=tenant and (public.user_has_branch_access(actor,b.id) or public.user_has_permission(actor,'reports.view_all_branches'))
   and public._staff_inventory_row_visible(b.id) and public._staff_my_inventory_view(b.id);
 select coalesce(array_agg(b.id),'{}'::uuid[]) into branches from public.branches b
  where b.tenant_id=tenant and public.user_has_branch_access(actor,b.id)
   and public._staff_permission_at_scope(actor,code,b.id);
 branches:=array(select distinct v from unnest(branches||view_branches) v);
 if (p_branch is null and cardinality(branches)=0) or (p_branch is not null and not coalesce(p_branch=any(branches),false))
  then raise exception 'STOCK_WORK_DOCUMENT_DENIED' using errcode='42501'; end if;
 if (p_amount_min is not null or p_amount_max is not null) and not show_cost then
  raise exception 'STOCK_WORK_VALUE_FILTER_DENIED' using errcode='42501'; end if;
 if p_amount_min is not null and p_amount_max is not null and p_amount_min>p_amount_max then
  raise exception 'STOCK_WORK_VALUE_RANGE_INVALID' using errcode='22023'; end if;
 with source as (
  select d.id,d.branch_id,d.code,d.status,d.created_at,d.created_by,d.note,d.reason,null::text department,d.total_amount,
   (select count(*)::integer from public.disposal_export_items i where i.disposal_id=d.id) total_products,
   case when q is not null and coalesce(p_search_field,'all') in ('all','product') then
    exists(select 1 from public.disposal_export_items i left join public.products p on p.id=i.product_id and p.tenant_id=tenant
      where i.disposal_id=d.id and position(q in lower(concat_ws(' ',i.product_name,p.code)))>0) else false end product_match
  from public.disposal_exports d where p_kind='disposal_export' and d.tenant_id=tenant and d.branch_id=any(branches)
  union all
  select d.id,d.branch_id,d.code,d.status,d.created_at,d.created_by,d.note,null::text,d.department,d.total_amount,
   (select count(*)::integer from public.internal_export_items i where i.export_id=d.id),
   case when q is not null and coalesce(p_search_field,'all') in ('all','product') then
    exists(select 1 from public.internal_export_items i left join public.products p on p.id=i.product_id and p.tenant_id=tenant
      where i.export_id=d.id and position(q in lower(concat_ws(' ',i.product_name,p.code)))>0) else false end
  from public.internal_exports d where p_kind='internal_export' and d.tenant_id=tenant and d.branch_id=any(branches)
 ), enriched as (
  select s.*,b.name branch_name,p.full_name creator_name from source s
   left join public.branches b on b.id=s.branch_id and b.tenant_id=tenant
   left join public.profiles p on p.id=s.created_by and p.tenant_id=tenant
 ), filtered as (
  select s.* from enriched s where (p_branch is null or s.branch_id=p_branch)
   and (coalesce(cardinality(p_statuses),0)=0 or s.status=any(p_statuses))
   and (p_from is null or s.created_at>=p_from) and (p_to is null or s.created_at<p_to)
   and (p_created_by is null or s.created_by=p_created_by)
   and (p_amount_min is null or s.total_amount>=p_amount_min) and (p_amount_max is null or s.total_amount<=p_amount_max)
   and (q is null or case coalesce(p_search_field,'all')
    when 'product' then s.product_match
    when 'code' then position(q in lower(coalesce(s.code,'')))>0
    when 'reason' then position(q in lower(coalesce(s.reason,'')))>0
    when 'department' then position(q in lower(coalesce(s.department,'')))>0
    when 'note' then position(q in lower(coalesce(s.note,'')))>0
    when 'creator' then position(q in lower(coalesce(s.creator_name,'')))>0
    else position(q in lower(concat_ws(' ',s.code,s.reason,s.department,s.note,s.creator_name)))>0 or s.product_match end)
 ), ranked as (select f.*,row_number() over(order by f.created_at desc,f.id) rn from filtered f),
 paged as (select * from ranked where rn>page_no*page_size and rn<=(page_no+1)*page_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
  'id',r.id,'branch_id',r.branch_id,'code',r.code,'status',r.status,'created_at',r.created_at,
  'created_by',r.created_by,'note',r.note,'reason',r.reason,'department',r.department,
  'total_products',r.total_products,'total_amount',case when show_cost then r.total_amount else null end,
  'costVisible',show_cost,'profiles',jsonb_build_object('full_name',r.creator_name),
  'branches',jsonb_build_object('name',r.branch_name)) order by r.rn) from paged r),'[]'::jsonb),
  'total',(select count(*) from filtered),'costVisible',show_cost,'summary',jsonb_build_object(
   'completedCount',(select count(*) from filtered where status='completed'),
   'draftCount',(select count(*) from filtered where status='draft'),
   'cancelledCount',(select count(*) from filtered where status='cancelled'),
   'completedValue',case when show_cost then (select coalesce(sum(total_amount) filter(where status='completed'),0) from filtered) else null end)) into result;
 return result;
end $$;
revoke all on function public.get_stock_work_document_list(text,uuid,integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric) from public,anon;
grant execute on function public.get_stock_work_document_list(text,uuid,integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric) to authenticated;
commit;
