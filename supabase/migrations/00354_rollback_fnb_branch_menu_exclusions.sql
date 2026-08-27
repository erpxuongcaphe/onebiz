-- 00354 rollback is intentionally a no-op.
--
-- Dropping an `except` policy would immediately show draft menu items again
-- at the protected outlet, while dropping an `only` policy would re-open a
-- pilot SKU at unrelated outlets. Neither is a safe recovery for a live POS.
--
-- The migration changes no business data. Recover one SKU through the product
-- editor by saving the desired policy (all / only / except) after review.

begin;

do $guard$
begin
  if to_regclass('public.fnb_product_branch_menu_policies') is null
     or to_regprocedure('public.save_fnb_product_branch_menu_policy(uuid,text,uuid[])') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00354_POLICY_GUARD_MISSING';
  end if;
end;
$guard$;

commit;
