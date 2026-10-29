-- Contact-only F&B buyer lookup. No writes, employee provisioning or account switch.
begin;
set local lock_timeout='2s';
set local statement_timeout='8s';
create or replace function public._fnb_buyer_search_key(p_text text) returns text
language sql immutable parallel safe set search_path=pg_catalog as $$
 select btrim(regexp_replace(regexp_replace(replace(lower(normalize(coalesce(p_text,''),NFD)),'đ','d'),'[̀-ͯ]','','g'),'[^[:alnum:]]+',' ','g'));
$$;
revoke all on function public._fnb_buyer_search_key(text) from public,anon,authenticated;

create or replace function public.fnb_buyer_lookup_v1(p_branch_id uuid,p_search text default null,p_kind text default 'customer')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a uuid:=auth.uid(); t uuid; q text;
begin
 select tenant_id into t from public.profiles where id=a and coalesce(is_active,true);
 if t is null or not public.user_has_permission(a,'pos_fnb.checkout') then
  raise exception 'FNB_BUYER_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_branch_id is null or not exists(select 1 from public.branches where id=p_branch_id and tenant_id=t and coalesce(is_active,true))
 or not (public.user_has_permission(a,'reports.view_all_branches') or public.user_has_branch_access(a,p_branch_id)) then
  raise exception 'FNB_BUYER_BRANCH_DENIED' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('customer','employee') or length(coalesce(p_search,''))>128 then
  raise exception 'FNB_BUYER_FILTER_INVALID' using errcode='22023';
 end if;
 q:=public._fnb_buyer_search_key(p_search);
 if p_kind='employee' then
  return (select coalesce(jsonb_agg(x.payload order by x.name,x.id),'[]'::jsonb) from (
   select c.id,c.name,jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'phone','',
    'employee_id',s.id,'benefit_groups',groups.names) payload
   from public.promotion_employee_customers l
   join public.customers c on c.id=l.customer_id and c.tenant_id=t
   join public.profiles s on s.id=l.profile_id and s.tenant_id=t and coalesce(s.is_active,true)
   cross join lateral (select coalesce(jsonb_agg(g.name order by g.name),'[]'::jsonb) names
    from public.employee_benefit_members m join public.employee_benefit_groups g on g.id=m.group_id and g.tenant_id=t
    where m.profile_id=s.id) groups
   where l.tenant_id=t and coalesce(c.is_active,true) and not coalesce(c.is_internal,false)
    and c.canonical_customer_id is null
    and (q='' or position(q in public._fnb_buyer_search_key(c.name||' '||c.code||' '||coalesce(s.full_name,'')||' '||groups.names::text))>0)
   order by c.name,c.id limit 10
  ) x);
 end if;
 return (select coalesce(jsonb_agg(x.payload order by x.name,x.id),'[]'::jsonb) from (
  select c.id,c.name,jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'phone',c.phone) payload
  from public.customers c
  where c.tenant_id=t and coalesce(c.is_active,true) and not coalesce(c.is_internal,false)
   and not coalesce(c.is_walk_in,false) and c.canonical_customer_id is null
   and not exists(select 1 from public.promotion_employee_customers l where l.customer_id=c.id and l.tenant_id=t)
   and (q='' or position(q in public._fnb_buyer_search_key(c.name||' '||c.code||' '||coalesce(c.phone,'')))>0)
  order by c.name,c.id limit 10
 ) x);
end $$;
revoke all on function public.fnb_buyer_lookup_v1(uuid,text,text) from public,anon;
grant execute on function public.fnb_buyer_lookup_v1(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
