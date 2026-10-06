begin;

alter table public.management_finance_categories
 add column cash_flow_activity text not null default 'unclassified'
 check (cash_flow_activity in ('operating','investing','financing','unclassified'));

-- Configure known catalog items only; historical cash and recognition rows are unchanged.
update public.management_finance_categories set cash_flow_activity='operating'
 where code in ('CP-VH-DIEN','CP-VH-NUOC','CP-VH-THUE','CP-VH-INTERNET','CP-VH-SUACHUA',
 'CP-VH-TIEUHAO','CP-NS-LUONG','CP-NS-PHUCAP','CP-BH-QUANGCAO','CP-BH-GIAOHANG',
 'CP-BH-NENTANG','CP-TC-NGANHANG','CP-KH-KHAC','TN-KH-KHAC');
update public.management_finance_categories set cash_flow_activity='investing'
 where code in ('NG-PNL-TAISAN','TN-TC-LAI');
update public.management_finance_categories set cash_flow_activity='financing'
 where code in ('NG-PNL-VON','NG-PNL-VAY','CP-TC-LAIVAY');

create function public.save_management_finance_category_with_cash_flow(
 p_code text,p_name text,p_kind text,p_parent_id uuid,p_cash_flow_activity text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; begin
 if p_cash_flow_activity is null or p_cash_flow_activity not in ('operating','investing','financing','unclassified')
 then raise exception 'FINANCE_CASH_FLOW_ACTIVITY_INVALID' using errcode='22023'; end if;
 v_result:=public.save_management_finance_category(p_code,p_name,p_kind,p_parent_id);
 update public.management_finance_categories set cash_flow_activity=p_cash_flow_activity
 where id=(v_result->>'id')::uuid returning to_jsonb(management_finance_categories.*) into v_result;
 insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values((v_result->>'tenant_id')::uuid,auth.uid(),'set_cash_flow_activity','management_finance_category',(v_result->>'id')::uuid,
 jsonb_build_object('cash_flow_activity',p_cash_flow_activity));
 return v_result;
end; $$;

create function public.get_management_finance_cash_links(
 p_date_from date,p_date_to date,p_branch_id uuid default null,p_page integer default 0,p_page_size integer default 200
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_tenant uuid:=public.management_finance_actor('finance.view_cash_book'); v_result jsonb; begin
 if p_date_from is null or p_date_to is null or not isfinite(p_date_from) or not isfinite(p_date_to)
 or p_date_from>p_date_to or p_page is null or p_page<0 or p_page_size is null or p_page_size not between 1 and 200
 then raise exception 'FINANCE_REPORT_FILTER_INVALID' using errcode='22023'; end if;
 if p_branch_id is not null and (not public.user_has_branch_access(auth.uid(),p_branch_id)
 or not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant))
 then raise exception 'FINANCE_BRANCH_DENIED' using errcode='42501'; end if;
 with source as (
  select c.id as cash_id,e.id as event_id,e.code as event_code,e.category_code,e.category_name,e.kind,
   cat.cash_flow_activity,e.business_date,e.status as event_status
  from public.management_finance_settlements s
  join public.management_finance_events e on e.id=s.event_id and e.tenant_id=v_tenant
  join public.management_finance_categories cat on cat.id=e.category_id and cat.tenant_id=v_tenant
  join public.cash_transactions c on c.id=s.cash_transaction_id and c.tenant_id=v_tenant
  where c.status='completed' and c.transaction_date between p_date_from and p_date_to
   and (p_branch_id is null or c.branch_id=p_branch_id)
   and public.user_has_branch_access(auth.uid(),c.branch_id)
   and not exists(select 1 from public.management_finance_allocations a
    where a.event_id=e.id and not public.user_has_branch_access(auth.uid(),a.branch_id))
 ), ranked as (select *,row_number() over(order by cash_id) as rn from source)
 select jsonb_build_object('total',(select count(*) from source),'items',
  coalesce((select jsonb_agg(to_jsonb(r)-'rn' order by rn) from ranked r
   where rn>p_page::bigint*p_page_size and rn<=(p_page::bigint+1)*p_page_size),'[]'::jsonb)) into v_result;
 return v_result;
end; $$;

revoke all on function public.save_management_finance_category_with_cash_flow(text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.get_management_finance_cash_links(date,date,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.save_management_finance_category_with_cash_flow(text,text,text,uuid,text) to authenticated;
grant execute on function public.get_management_finance_cash_links(date,date,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
