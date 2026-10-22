-- Merge-only access for cashiers. Existing table managers retain their access.
-- Installing this migration does not merge or update any bill, item or payment.
begin;
set local lock_timeout='3s';

do $guard$
declare
  definition text := pg_get_functiondef('public.merge_kitchen_orders_atomic(uuid,uuid[])'::regprocedure);
  old_guard text := 'if not public.user_has_permission(v_actor, ''pos_fnb.manage_tables'') then';
  new_guard text := 'if not coalesce(public.user_has_permission(v_actor, ''pos_fnb.merge_bills''), false)
     and not coalesce(public.user_has_permission(v_actor, ''pos_fnb.manage_tables''), false) then';
begin
  if strpos(definition, new_guard) = 0 then
    if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1
       or strpos(definition,'FNB_MERGE_TOO_MANY_ORDERS') = 0 then
      raise exception 'FNB_MERGE_PERMISSION_GUARD_DRIFT';
    end if;
    execute replace(definition,old_guard,new_guard);
  end if;
end $guard$;

-- Use the normal role grants; per-user revocations remain effective.
insert into public.role_permissions(role_id,permission_code)
select id,'pos_fnb.merge_bills' from public.roles
where name='Thu ngân F&B'
on conflict(role_id,permission_code) do nothing;
commit;
