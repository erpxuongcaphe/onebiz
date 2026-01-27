-- OneBiz ERP - Allow user to set current branch

create or replace function public.set_my_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
begin
  if not public.has_permission('branch.switch') and not public.has_permission('branch.read_all') then
    raise exception 'Permission denied';
  end if;

  t_id := public.current_tenant_id();
  if t_id is null then
    raise exception 'No tenant for current user';
  end if;

  if not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.tenant_id = t_id and b.status = 'active'
  ) then
    raise exception 'Branch not found in tenant';
  end if;

  update public.profiles
  set branch_id = p_branch_id,
      updated_at = now()
  where id = auth.uid() and tenant_id = t_id;
end;
$$;

grant execute on function public.set_my_branch(uuid) to authenticated;
