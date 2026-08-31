-- Roll back the 00366 wrapper. Business BOM and variant rows are untouched.

begin;

drop function if exists public.save_fnb_size_setup_atomic(uuid, jsonb);

do $restore_00357$
begin
  if to_regprocedure('public.save_fnb_size_setup_atomic_00357(uuid,jsonb)') is not null then
    alter function public.save_fnb_size_setup_atomic_00357(uuid, jsonb)
      rename to save_fnb_size_setup_atomic;
  end if;
end;
$restore_00357$;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

commit;

notify pgrst, 'reload schema';
