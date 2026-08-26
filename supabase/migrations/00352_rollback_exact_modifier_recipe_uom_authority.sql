-- 00352 rollback is intentionally a no-op.
--
-- This migration only installs a server-side unit guard and does not alter
-- business rows. Removing that guard would make an old browser able to save
-- a human quantity (for example 21 G) as a stock quantity (21 Kg), so there
-- is no safe data-preserving reversal. Roll back the application only after
-- it no longer exposes exact recipe editing; keep the database guard in place.

begin;

do $guard$
begin
  if to_regprocedure('public.save_bom_modifier_option_quantities(uuid,jsonb)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00352_SAVE_RPC_MISSING';
  end if;
end;
$guard$;

commit;
