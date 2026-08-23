-- Roll back phase A only before the later legacy-entrypoint revocation is
-- applied. No business rows are changed.
begin;

do $$
begin
  if to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_V3_NOT_FOUND';
  end if;
  if not exists (
    select 1 from pg_proc p
     where p.oid = to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
       and obj_description(p.oid, 'pg_proc') like '00343 phase A:%'
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_PAYMENT_V3_UNEXPECTED_DEFINITION';
  end if;
end;
$$;

revoke all on function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
) from public, anon, authenticated;
drop function public.fnb_complete_payment_atomic_v3(
  uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text
);

commit;
notify pgrst, 'reload schema';
