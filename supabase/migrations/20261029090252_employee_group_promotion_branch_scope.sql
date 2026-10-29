-- Employee-group benefits follow the promotion's selected branches. Receiving
-- a benefit never grants the employee permission to log in to that branch.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '8s';

create or replace function public._promotion_customer_eligible_00458(
  p_promotion uuid, p_customer uuid, p_branch uuid
) returns boolean
language plpgsql stable security definer
set search_path = public, extensions
as $$
declare p public.promotions%rowtype; c public.customers%rowtype;
begin
  select * into p from promotions where id = p_promotion;
  if not found then return false; end if;
  if p.beneficiary_kind = 'all' then return true; end if;
  select * into c from customers where id = p_customer and tenant_id = p.tenant_id;
  if not found or coalesce(to_jsonb(c)->>'is_active','true') <> 'true'
     or to_jsonb(c)->>'deleted_at' is not null then return false; end if;
  case p.beneficiary_kind
    when 'customer' then return c.id = any(p.beneficiary_ids);
    when 'customer_group' then return c.group_id = any(p.beneficiary_ids);
    when 'employee_group' then
      -- Branch eligibility comes from the program, not staff login scope.
      return (coalesce(cardinality(p.branch_ids),0) = 0 or p_branch = any(p.branch_ids))
        and exists(select 1 from branches b where b.id = p_branch
          and b.tenant_id = p.tenant_id and coalesce(b.is_active,true))
        and exists(
          select 1 from promotion_employee_customers l
          join profiles staff on staff.id = l.profile_id
          join employee_benefit_members m on m.profile_id = staff.id
          join employee_benefit_groups g on g.id = m.group_id
          where l.tenant_id = p.tenant_id and l.customer_id = c.id
            and staff.tenant_id = p.tenant_id and coalesce(staff.is_active,true)
            and g.tenant_id = p.tenant_id and g.id = any(p.beneficiary_ids)
        );
    when 'employee' then
      return (cardinality(p.beneficiary_ids) = 0 or c.id = any(p.beneficiary_ids))
        and exists(select 1 from promotion_employee_customers l
          join profiles staff on staff.id = l.profile_id
          where l.tenant_id = p.tenant_id and l.customer_id = c.id
            and staff.tenant_id = p.tenant_id and coalesce(staff.is_active,true)
            and user_has_branch_access(staff.id,p_branch));
    else return false;
  end case;
end $$;
revoke all on function public._promotion_customer_eligible_00458(uuid,uuid,uuid)
  from public, anon, authenticated;
commit;
