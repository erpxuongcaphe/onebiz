-- Roll back 00368 and expose the authenticated 00367 wrapper again.

begin;

drop function if exists public.save_fnb_size_setup_atomic(uuid, jsonb);

alter function public.save_fnb_size_setup_atomic_00367(uuid, jsonb)
  rename to save_fnb_size_setup_atomic;

alter function public.save_fnb_size_setup_atomic(uuid, jsonb) owner to postgres;
revoke all on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_fnb_size_setup_atomic(uuid, jsonb)
  to authenticated;

comment on function public.save_fnb_size_setup_atomic(uuid, jsonb) is
  '00367: Atomically adopt a parent legacy BOM for the exact same-product size variant requested by the client.';

commit;

notify pgrst, 'reload schema';
