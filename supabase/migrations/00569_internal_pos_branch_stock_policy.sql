-- Respect the existing source-branch policy; do not change settings or documents.
begin;
set local lock_timeout = '3s';

do $patch$
declare
  definition text;
  old_check text := $old$if exists(select 1 from stock_movements m join branch_stock b on b.tenant_id=m.tenant_id and b.branch_id=m.branch_id and b.product_id=m.product_id
  where m.tenant_id=v_tenant and m.branch_id=v_branch and m.reference_id=v_invoice and m.type='out' and b.quantity<0) then raise exception 'INTERNAL_POS_INSUFFICIENT_STOCK'; end if;$old$;
  new_check text := $new$if not coalesce(public._allow_negative_sale_00473(v_tenant,v_branch),false) and exists(
  select 1 from stock_movements m join branch_stock b
   on b.tenant_id=m.tenant_id and b.branch_id=m.branch_id and b.product_id=m.product_id
   and b.variant_id is null
  where m.tenant_id=v_tenant and m.branch_id=v_branch and m.reference_id=v_invoice
   and m.type='out' and b.quantity<0
 ) then raise exception 'INTERNAL_POS_INSUFFICIENT_STOCK'; end if;$new$;
begin
  old_check := replace(old_check, E'\r\n', E'\n');
  new_check := replace(new_check, E'\r\n', E'\n');
  definition := replace(pg_get_functiondef('public.checkout_internal_pos_v2(jsonb)'::regprocedure), E'\r\n', E'\n');
  -- Keep subsequent approval, payment and receipt changes in the deployed function.
  if (length(definition)-length(replace(definition,old_check,'')))/length(old_check) <> 1 then
    raise exception 'INTERNAL_POS_STOCK_POLICY_PATCH_MISMATCH';
  end if;
  execute replace(definition,old_check,new_check);
end $patch$;

commit;
notify pgrst, 'reload schema';
