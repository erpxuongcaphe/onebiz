-- ============================================================================
-- 00351 rollback - chi go bo dong bo tu dong trong tuong lai
--
-- Co has_bom da duoc dong bo la thong tin dung, khong khoi phuc ve gia tri
-- sai cu. Khong dong vao BOM, ton kho, don bep, hoa don hay stock_movements.
-- ============================================================================

begin;

do $guard$
begin
  if to_regprocedure('public.sync_product_has_bom_from_active_bom(uuid)') is null
     or to_regprocedure('public.sync_product_bom_status_for_bom(uuid)') is null then
    raise exception using errcode = 'P0001', message = 'FNB_00351_ROLLBACK_SYNC_NOT_INSTALLED';
  end if;
end;
$guard$;

drop trigger if exists trg_sync_product_bom_status_item_00351 on public.bom_items;
drop trigger if exists trg_sync_product_bom_status_00351 on public.bom;
drop function if exists public.trg_sync_product_bom_status_item_00351();
drop function if exists public.trg_sync_product_bom_status_00351();
drop function if exists public.sync_product_bom_status_for_bom(uuid);
drop function if exists public.sync_product_has_bom_from_active_bom(uuid);

commit;
notify pgrst, 'reload schema';
