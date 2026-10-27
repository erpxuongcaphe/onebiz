-- Delivery membership is explicit assignment, not broad administration access.
-- No profile, branch assignment or historical order is rewritten.
create function public._fnb_delivery_staff_eligible_20261027(p_staff uuid, p_branch uuid, p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.branches b on b.id=p_branch and b.tenant_id=p.tenant_id and b.is_active=true
    left join public.roles r on r.id=p.role_id and r.tenant_id=p.tenant_id
    where p.id=p_staff and p.tenant_id=p_tenant and p.is_active=true
      and lower(coalesce(p.role,'')) not in ('owner','admin','ceo')
      and lower(btrim(coalesce(r.name,''))) not in ('admin','administrator','ceo','quản trị viên','chủ cửa hàng')
      and (p.branch_id=p_branch or exists (
        select 1 from public.user_branches ub where ub.user_id=p.id and ub.branch_id=p_branch
      ))
  );
$$;
revoke all on function public._fnb_delivery_staff_eligible_20261027(uuid,uuid,uuid) from public,anon,authenticated;

create function public.list_fnb_delivery_staff_20261027(p_branch_id uuid)
returns table(id uuid, full_name text) language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_tenant uuid;
begin
  select p.tenant_id into v_tenant from public.profiles p where p.id=v_actor and p.is_active=true;
  if v_tenant is null then raise exception 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor,'pos_fnb.send_kitchen') then raise exception 'INSUFFICIENT_PERMISSION'; end if;
  if p_branch_id is null or not public.user_has_branch_access(v_actor,p_branch_id)
    or not exists(select 1 from public.branches b where b.id=p_branch_id and b.tenant_id=v_tenant and b.is_active=true)
    then raise exception 'BRANCH_ACCESS_DENIED'; end if;
  return query select p.id,p.full_name from public.profiles p
    where p.tenant_id=v_tenant
      and public._fnb_delivery_staff_eligible_20261027(p.id,p_branch_id,v_tenant)
    order by p.full_name,p.id;
end;
$$;
revoke all on function public.list_fnb_delivery_staff_20261027(uuid) from public,anon;
grant execute on function public.list_fnb_delivery_staff_20261027(uuid) to authenticated;

-- Covers initial send/checkout and later reassignment without copying large RPCs.
-- Existing assignments survive profile changes and unrelated order updates.
create function public._guard_fnb_delivery_staff_20261027()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.delivery_staff_id is null then return new; end if;
  if tg_op='UPDATE' then
    if new.delivery_staff_id is not distinct from old.delivery_staff_id
      and new.branch_id is not distinct from old.branch_id
      and new.tenant_id is not distinct from old.tenant_id then return new; end if;
  end if;
  if not public._fnb_delivery_staff_eligible_20261027(new.delivery_staff_id,new.branch_id,new.tenant_id)
    then raise exception 'DELIVERY_STAFF_NOT_AVAILABLE_FOR_BRANCH'; end if;
  return new;
end;
$$;
revoke all on function public._guard_fnb_delivery_staff_20261027() from public,anon,authenticated;
create trigger guard_fnb_delivery_staff_20261027
  before insert or update of delivery_staff_id,branch_id,tenant_id on public.kitchen_orders
  for each row execute function public._guard_fnb_delivery_staff_20261027();
notify pgrst,'reload schema';
