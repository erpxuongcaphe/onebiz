-- API prerequisite: managed account creation supplies app_metadata.managed_tenant_id.
-- Deploy that API first, then apply this guard. Existing profiles are not changed.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $migration$
declare body text; rule record;
begin
 body:=pg_get_functiondef('public.handle_new_user()'::regprocedure);
 for rule in select * from (values
  ($old$invited_tenant := nullif(new.raw_user_meta_data ->> 'invited_tenant_id', '')::uuid;$old$,
   $new$invited_tenant := nullif(new.raw_app_meta_data ->> 'managed_tenant_id', '')::uuid;
  if invited_tenant is null and new.raw_user_meta_data ?| array['invited_tenant_id','invited_role_id','invited_branch_id','invited_role'] then
    raise exception 'MANAGED_ACCOUNT_SERVER_CONTEXT_REQUIRED' using errcode='42501';
  end if;$new$),
  ($old$new.raw_user_meta_data ->> 'invited_branch_id'$old$,$new$new.raw_app_meta_data ->> 'managed_branch_id'$new$),
  ($old$new.raw_user_meta_data ->> 'invited_role_id'$old$,$new$new.raw_app_meta_data ->> 'managed_role_id'$new$),
  ($old$coalesce(new.raw_user_meta_data ->> 'invited_role', 'staff')$old$,$new$'staff'$new$)
 ) patch(before_value,after_value) loop
  if strpos(body,rule.before_value)=0 then raise exception 'ACCOUNT_BOOTSTRAP_CONTRACT_CHANGED'; end if;
  body:=replace(body,rule.before_value,rule.after_value);
 end loop;
 execute body;
end $migration$;
comment on function public.handle_new_user() is 'Managed employees use server-controlled app_metadata, never user-writable tenant/role/branch fields. Existing accounts and independent tenant bootstrap are unchanged.';
commit;
