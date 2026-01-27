-- OneBiz ERP - Backfill branches for existing tenants/users

do $$
declare
  t record;
  b_id uuid;
begin
  for t in select id from public.tenants loop
    b_id := public.seed_default_branch(t.id);

    update public.profiles
    set branch_id = b_id
    where tenant_id = t.id
      and branch_id is null;
  end loop;
end $$;
