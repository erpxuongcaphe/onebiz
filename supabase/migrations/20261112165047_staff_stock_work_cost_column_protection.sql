-- Prevent direct Data API access to cost fields. Authenticated clients use the
-- scoped projections installed immediately before this migration. DML and
-- service-role grants are unchanged. The legacy workspaces fail closed for
-- clients without cost access rather than displaying a fabricated zero.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
revoke select on public.disposal_exports,public.disposal_export_items,public.internal_exports,public.internal_export_items from public,anon,authenticated;
revoke select(total_amount) on public.disposal_exports,public.internal_exports from public,anon,authenticated;
revoke select(unit_price,total,unit_cost) on public.disposal_export_items from public,anon,authenticated;
revoke select(unit_price,total) on public.internal_export_items from public,anon,authenticated;
grant select(id,tenant_id,branch_id,code,status,reason,note,created_by,created_at,updated_at) on public.disposal_exports to authenticated;
grant select(id,disposal_id,product_id,product_name,unit,quantity) on public.disposal_export_items to authenticated;
grant select(id,tenant_id,branch_id,code,status,department,note,created_by,created_at,updated_at) on public.internal_exports to authenticated;
grant select(id,export_id,product_id,product_name,unit,quantity) on public.internal_export_items to authenticated;

do $guard$
begin
 if to_regprocedure('public.get_disposal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,numeric,numeric,uuid)') is null
 or to_regprocedure('public.get_internal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric,uuid)') is null
 then raise exception 'STOCK_WORK_LEGACY_WORKSPACE_MISSING';end if;
end $guard$;
create or replace function public.get_disposal_export_list_workspace(
 p_page integer default 0,p_page_size integer default 20,p_search text default null,p_search_field text default 'all',
 p_statuses text[] default null,p_date_from timestamptz default null,p_date_to_exclusive timestamptz default null,
 p_amount_min numeric default null,p_amount_max numeric default null,p_branch_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.get_stock_work_document_list('disposal_export',p_branch_id,p_page,p_page_size,p_search,p_search_field,p_statuses,p_date_from,p_date_to_exclusive,null,p_amount_min,p_amount_max);
 if not coalesce((result->>'costVisible')::boolean,false) then
  raise exception 'STOCK_WORK_REFRESH_REQUIRED' using errcode='42501';end if;
 return result;
end $$;
create or replace function public.get_internal_export_list_workspace(
 p_page integer default 0,p_page_size integer default 20,p_search text default null,p_search_field text default 'all',
 p_statuses text[] default null,p_date_from timestamptz default null,p_date_to_exclusive timestamptz default null,
 p_created_by uuid default null,p_amount_min numeric default null,p_amount_max numeric default null,p_branch_id uuid default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.get_stock_work_document_list('internal_export',p_branch_id,p_page,p_page_size,p_search,p_search_field,p_statuses,p_date_from,p_date_to_exclusive,p_created_by,p_amount_min,p_amount_max);
 if not coalesce((result->>'costVisible')::boolean,false) then
  raise exception 'STOCK_WORK_REFRESH_REQUIRED' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.get_disposal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,numeric,numeric,uuid),public.get_internal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric,uuid) from public,anon;
grant execute on function public.get_disposal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,numeric,numeric,uuid),public.get_internal_export_list_workspace(integer,integer,text,text,text[],timestamptz,timestamptz,uuid,numeric,numeric,uuid) to authenticated;
commit;
