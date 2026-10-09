-- Benefit groups are independent of login roles. No existing policies or sales rewritten.
begin;
set local lock_timeout='3s';
create table if not exists public.employee_benefit_groups (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 100),
 updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default now(),
 unique(tenant_id,name)
);
create table if not exists public.employee_benefit_members (
 group_id uuid not null references public.employee_benefit_groups(id),
 profile_id uuid not null references public.profiles(id),primary key(group_id,profile_id)
);
alter table public.employee_benefit_groups enable row level security;
alter table public.employee_benefit_members enable row level security;
revoke all on public.employee_benefit_groups,public.employee_benefit_members from public,anon,authenticated;
alter table public.promotions drop constraint if exists promotions_beneficiary_kind_check;
alter table public.promotions add constraint promotions_beneficiary_kind_check
 check(beneficiary_kind in ('all','customer','customer_group','employee','employee_group'));

create or replace function public.employee_benefit_options_00463() returns jsonb
language plpgsql stable security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'products.manage_prices') then raise exception 'PERMISSION_DENIED'; end if;
 return jsonb_build_object(
 'groups',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select g.id,g.name,
 coalesce((select jsonb_agg(m.profile_id) from employee_benefit_members m where m.group_id=g.id),'[]') member_ids
 from employee_benefit_groups g where g.tenant_id=t order by g.name) q),
 'staff',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select p.id,p.full_name name,l.customer_id
 from profiles p left join promotion_employee_customers l on l.profile_id=p.id and l.tenant_id=t
 where p.tenant_id=t and coalesce(p.is_active,true) and user_has_branch_access(a,p.branch_id) order by p.full_name) q));
end $$;

create or replace function public.employee_benefit_save_group_00463(p_id uuid,p_name text,p_members uuid[]) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; g uuid; customer_group uuid; member uuid; c uuid; prefix text; counter integer;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'products.manage_prices') or not user_has_permission(a,'customers.edit') then raise exception 'PERMISSION_DENIED'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 100 or cardinality(p_members) not between 1 and 500
 or p_members is null or array_position(p_members,null) is not null then raise exception 'BENEFIT_GROUP_INVALID'; end if;
 if exists(select 1 from unnest(p_members) m left join profiles p on p.id=m and p.tenant_id=t and coalesce(p.is_active,true)
 where p.id is null or not user_has_branch_access(a,p.branch_id)) then raise exception 'EMPLOYEE_BRANCH_ACCESS_DENIED'; end if;
 -- Serialize group/customer provisioning. Each employee gets at most one benefit identity.
 perform pg_advisory_xact_lock(hashtextextended('employee-benefit:'||t::text,0));
 if p_id is null then
  insert into employee_benefit_groups(tenant_id,name,updated_by) values(t,trim(p_name),a) returning id into g;
 else
  select id into g from employee_benefit_groups where id=p_id and tenant_id=t for update;
  if g is null then raise exception 'BENEFIT_GROUP_NOT_FOUND'; end if;
  -- A manager cannot silently remove members outside their branch access.
  if exists(select 1 from employee_benefit_members m join profiles p on p.id=m.profile_id where m.group_id=g and not user_has_branch_access(a,p.branch_id)) then raise exception 'EMPLOYEE_BRANCH_ACCESS_DENIED'; end if;
  update employee_benefit_groups set name=trim(p_name),updated_by=a,updated_at=now() where id=g;
 end if;
 foreach member in array p_members loop
  select customer_id into c from promotion_employee_customers where tenant_id=t and profile_id=member;
  if c is null then
   select id into customer_group from customer_groups where tenant_id=t and name='Nhân viên nội bộ'
    and code ~ '^NV([0-9]{2})?$' and discount_percent=0 order by code limit 1;
   if customer_group is null then
    -- Do not reuse another group's pricing policy merely because its code is NV.
    for counter in 0..99 loop
     prefix:=case when counter=0 then 'NV' else 'NV'||lpad(counter::text,2,'0') end;
     exit when not exists(select 1 from customer_groups where tenant_id=t and code=prefix);
    end loop;
    if exists(select 1 from customer_groups where tenant_id=t and code=prefix) then raise exception 'EMPLOYEE_GROUP_CODE_UNAVAILABLE'; end if;
    insert into customer_groups(tenant_id,name,code) values(t,'Nhân viên nội bộ',prefix) returning id into customer_group;
   end if;
   -- Existing allocator issues KHA-NV-###. Never invent a separate code format.
   insert into customers(tenant_id,code,name,group_id)
   select t,'',coalesce(nullif(trim(full_name),''),'Nhân viên'),customer_group from profiles where id=member returning id into c;
   insert into promotion_employee_customers(tenant_id,customer_id,profile_id,updated_by) values(t,c,member,a);
  end if;
 end loop;
 delete from employee_benefit_members where group_id=g;
 insert into employee_benefit_members(group_id,profile_id) select g,m from (select distinct unnest(p_members) m) selected;
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
 values(t,a,'employee_benefit_group_save','employee_benefit_group',g,jsonb_build_object('name',trim(p_name),'member_ids',p_members));
 return g;
end $$;

do $patch$
declare target regprocedure; definition text; anchor text;
begin
 target:='public._promotion_customer_eligible_00458(uuid,uuid,uuid)'::regprocedure;
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 anchor:=' when ''employee'' then';
 if position('employee_group' in definition)=0 then
  if position(anchor in definition)=0 then raise exception 'BENEFIT_ELIGIBILITY_SOURCE_CHANGED'; end if;
  execute replace(definition,anchor,
   ' when ''employee_group'' then return exists(select 1 from promotion_employee_customers l join profiles staff on staff.id=l.profile_id join employee_benefit_members m on m.profile_id=staff.id join employee_benefit_groups g on g.id=m.group_id where l.tenant_id=p.tenant_id and l.customer_id=c.id and staff.tenant_id=p.tenant_id and coalesce(staff.is_active,true) and user_has_branch_access(staff.id,p_branch) and g.tenant_id=p.tenant_id and g.id=any(p.beneficiary_ids));'||E'\n'||anchor);
 end if;
end $patch$;
revoke all on function public.employee_benefit_options_00463(),public.employee_benefit_save_group_00463(uuid,text,uuid[]) from public,anon;
grant execute on function public.employee_benefit_options_00463(),public.employee_benefit_save_group_00463(uuid,text,uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
