begin;
set local lock_timeout='3s';
alter table public.promotions add column if not exists beneficiary_kind text not null default 'all' check(beneficiary_kind in ('all','customer','customer_group','employee'));
alter table public.promotions add column if not exists beneficiary_ids uuid[] not null default '{}';
create table if not exists public.promotion_employee_customers (
 tenant_id uuid not null,customer_id uuid primary key references public.customers(id),
 profile_id uuid not null references public.profiles(id),updated_by uuid not null,updated_at timestamptz not null default now(),unique(tenant_id,profile_id)
);
alter table public.promotion_employee_customers enable row level security;
revoke all on public.promotion_employee_customers from public,anon,authenticated;
create or replace function public._promotion_customer_eligible_00458(p_promotion uuid,p_customer uuid,p_branch uuid) returns boolean
language plpgsql stable security definer set search_path=public,extensions as $$
declare p public.promotions%rowtype; c public.customers%rowtype;
begin
 select * into p from promotions where id=p_promotion;
 if not found then return false; end if;
 if p.beneficiary_kind='all' then return true; end if;
 select * into c from customers where id=p_customer and tenant_id=p.tenant_id;
 if not found or coalesce(to_jsonb(c)->>'is_active','true')<>'true' or to_jsonb(c)->>'deleted_at' is not null then return false; end if;
 case p.beneficiary_kind
 when 'customer' then return c.id=any(p.beneficiary_ids);
 when 'customer_group' then return c.group_id=any(p.beneficiary_ids);
 when 'employee' then return (cardinality(p.beneficiary_ids)=0 or c.id=any(p.beneficiary_ids)) and exists(
 select 1 from promotion_employee_customers l join profiles staff on staff.id=l.profile_id
 where l.tenant_id=p.tenant_id and l.customer_id=c.id and staff.tenant_id=p.tenant_id and coalesce(staff.is_active,true)
 and user_has_branch_access(staff.id,p_branch));
 else return false; end case;
end $$;
revoke all on function public._promotion_customer_eligible_00458(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.promotion_eligible_ids_00458(p_ids uuid[],p_customer_id uuid,p_branch_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; result jsonb;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_branch_access(a,p_branch_id) or cardinality(p_ids)>200 then raise exception 'PERMISSION_DENIED'; end if;
 select coalesce(jsonb_agg(id),'[]') into result from promotions where tenant_id=t and id=any(p_ids)
 and _promotion_customer_eligible_00458(id,p_customer_id,p_branch_id);
 return result;
end $$;

create or replace function public.promotion_beneficiary_options_00458(p_search text default '',p_selected_ids uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'products.manage_prices') or cardinality(p_selected_ids)>500 then raise exception 'PERMISSION_DENIED'; end if;
 return jsonb_build_object(
 'customers',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select c.id,c.name,l.profile_id,staff.full_name employee_name from customers c left join promotion_employee_customers l on l.customer_id=c.id and l.tenant_id=t left join profiles staff on staff.id=l.profile_id and staff.tenant_id=t where c.tenant_id=t and (c.id=any(p_selected_ids) or c.name ilike '%'||left(p_search,100)||'%') and coalesce(to_jsonb(c)->>'deleted_at','')='' order by c.id=any(p_selected_ids) desc,c.name limit 100) q),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from customer_groups where tenant_id=t),
 'staff',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)),'[]') from profiles where tenant_id=t and coalesce(is_active,true) and user_has_branch_access(a,branch_id)));
end $$;

create or replace function public.promotion_link_employee_customer_00458(p_customer_id uuid,p_profile_id uuid) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare a uuid:=auth.uid(); t uuid; staff public.profiles%rowtype;
begin
 select tenant_id into t from profiles where id=a and coalesce(is_active,true);
 if t is null or not user_has_permission(a,'products.manage_prices') or not user_has_permission(a,'customers.edit') then raise exception 'PERMISSION_DENIED'; end if;
 perform 1 from customers where id=p_customer_id and tenant_id=t for update;
 if not found then raise exception 'CUSTOMER_NOT_FOUND'; end if;
 select * into staff from profiles where id=p_profile_id and tenant_id=t and coalesce(is_active,true);
 if not found or not user_has_branch_access(a,staff.branch_id) then raise exception 'EMPLOYEE_BRANCH_ACCESS_DENIED'; end if;
 insert into promotion_employee_customers(tenant_id,customer_id,profile_id,updated_by) values(t,p_customer_id,p_profile_id,a)
 on conflict(customer_id) do update set profile_id=excluded.profile_id,updated_by=a,updated_at=now();
 insert into audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data) values(t,a,'promotion_employee_link','customer',p_customer_id,jsonb_build_object('employee_profile_id',p_profile_id));
end $$;

do $patch$
declare target regprocedure:=to_regprocedure('public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'); definition text;
anchor text:='    if (v_promotion.time_start is null) <> (v_promotion.time_end is null) then';
begin
 if target is null then raise exception 'PROMOTION_BENEFICIARY_PAYMENT_PREREQUISITE'; end if;
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('_promotion_customer_eligible_00458' in definition)>0 then return; end if;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'PROMOTION_BENEFICIARY_PAYMENT_SOURCE_CHANGED'; end if;
 execute replace(definition,anchor,'    if not public._promotion_customer_eligible_00458(p_promotion_id,p_customer_id,v_order.branch_id) then raise exception ''FNB_PROMOTION_CUSTOMER_NOT_ELIGIBLE''; end if;'||E'\n'||anchor);
end $patch$;
-- Keep Retail's existing authoritative pricing path consistent with ERP policies.
do $retail$
declare target regprocedure:=to_regprocedure('public.pos_prepare_retail_checkout(uuid,uuid,uuid,uuid,jsonb,text,numeric,uuid,text,integer,uuid,numeric,numeric)'); definition text;
anchor text:='    if not found or v_subtotal < coalesce(v_promotion.min_order_amount, 0) then';
begin
 if target is null then return; end if; -- Some F&B-only installations lack Retail.
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('_promotion_customer_eligible_00458' in definition)>0 then return; end if;
 if position(anchor in definition)=0 or length(definition)-length(replace(definition,anchor,''))<>length(anchor) then raise exception 'PROMOTION_BENEFICIARY_RETAIL_SOURCE_CHANGED'; end if;
 execute replace(definition,anchor,'    if not public._promotion_customer_eligible_00458(p_promotion_id,p_customer_id,p_branch_id) then raise exception ''POS_PROMOTION_INVALID''; end if;'||E'\n'||anchor);
end $retail$;
-- Restrictive policies supplement existing tenant policies; cashiers cannot edit programs.
drop policy if exists promotions_manage_insert_00458 on public.promotions;
create policy promotions_manage_insert_00458 on public.promotions as restrictive for insert to authenticated
with check (public.user_has_permission(auth.uid(),'products.manage_prices'));
drop policy if exists promotions_manage_update_00458 on public.promotions;
create policy promotions_manage_update_00458 on public.promotions as restrictive for update to authenticated
using (public.user_has_permission(auth.uid(),'products.manage_prices')) with check (public.user_has_permission(auth.uid(),'products.manage_prices'));
drop policy if exists promotions_manage_delete_00458 on public.promotions;
create policy promotions_manage_delete_00458 on public.promotions as restrictive for delete to authenticated
using (public.user_has_permission(auth.uid(),'products.manage_prices'));
-- Freeze the actual employee beneficiary on new checkout snapshots.
do $snapshot$
declare target regprocedure:=to_regprocedure('public._fnb_allocate_invoice_discounts_00457(uuid,uuid,text,numeric,numeric)'); definition text;
anchor text:='''branch_id'',inv.branch_id';
begin
 definition:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
 if position('employee_profile_id' in definition)>0 then return; end if;
 if position(anchor in definition)=0 then raise exception 'PROMOTION_BENEFICIARY_SNAPSHOT_SOURCE_CHANGED'; end if;
 execute replace(definition,anchor,anchor||',''employee_profile_id'',(select profile_id from public.promotion_employee_customers where customer_id=inv.customer_id and tenant_id=inv.tenant_id)');
end $snapshot$;
revoke all on function public.promotion_eligible_ids_00458(uuid[],uuid,uuid),public.promotion_beneficiary_options_00458(text,uuid[]),public.promotion_link_employee_customer_00458(uuid,uuid) from public,anon;
grant execute on function public.promotion_eligible_ids_00458(uuid[],uuid,uuid),public.promotion_beneficiary_options_00458(text,uuid[]),public.promotion_link_employee_customer_00458(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
