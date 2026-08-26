-- 00353 rollback is intentionally a no-op.
--
-- Removing a configured branch whitelist would immediately re-open a pilot
-- SKU at other FnB outlets and could let an old POS tab send a wrong-branch
-- kitchen order. The migration does not mutate business rows, so the safe
-- recovery path is to restore an individual SKU to the "all branches" mode
-- through save_fnb_product_branch_menu_scope(..., '{}') after review.

begin;

do $guard$
begin
  if to_regclass('public.fnb_product_branch_menu_scopes') is null
     or to_regprocedure('public.save_fnb_product_branch_menu_scope(uuid,uuid[])') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00353_SCOPE_GUARD_MISSING';
  end if;
end;
$guard$;

commit;
