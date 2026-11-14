-- History marker for the atomic MKT release recorded by the management API.
-- On a fresh database the 32 preceding migrations perform the actual work.
do $$begin
 if (select count(*) from public.staff_branch_permission_catalog where permission_code in ('mkt.view','mkt.manage_campaigns','mkt.split_work_packages')) <> 3 then
  raise exception 'MKT_ATOMIC_RELEASE_CATALOG_MISSING';
 end if;
end$$;
