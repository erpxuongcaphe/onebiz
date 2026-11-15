-- Records the management API release version without changing permissions.
do $$
begin
  if (select count(*) from public.staff_branch_permission_catalog
      where permission_code in ('mkt.readiness.finance','mkt.readiness.ops',
        'mkt.readiness.warehouse','mkt.readiness.store','mkt.readiness.ceo')) <> 5
    or to_regprocedure('public.mkt_confirmable_readiness_ids(uuid)') is null then
    raise exception 'MKT_READINESS_BRANCH_SCOPE_NOT_APPLIED';
  end if;
end $$;
