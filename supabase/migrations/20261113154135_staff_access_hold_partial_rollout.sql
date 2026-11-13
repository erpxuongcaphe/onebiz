-- The new staff editor is not deployed yet. Prevent partial branch changes
-- until every server-side authorization migration is present.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.save_staff_profile_access(uuid,text,jsonb)') is null
 or not has_function_privilege('authenticated','public.save_staff_profile_access(uuid,text,jsonb)','execute')
 or exists(select 1 from public.user_branch_permission_overrides) then
  raise exception 'STAFF_ROLLOUT_HOLD_PRECONDITION_FAILED';
 end if;
end$$;
revoke execute on function public.save_staff_profile_access(uuid,text,jsonb) from authenticated;
commit;
