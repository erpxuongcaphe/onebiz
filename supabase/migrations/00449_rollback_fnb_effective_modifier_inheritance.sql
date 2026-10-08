-- Restore only when no later patch has changed this implementation.
begin;
do $rollback$
declare
  v_current text := pg_get_functiondef(to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'));
  v_backup text := pg_get_functiondef(to_regprocedure('public._fnb_send_to_kitchen_impl_before_00449(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'));
  v_old text := '(pmg.id is not null or cmg.id is not null)';
  v_new text := '(pmg.id is not null or (cmg.id is not null and not exists (
            select 1 from public.product_modifier_groups own_link
             where own_link.product_id = v_product.id
               and own_link.tenant_id = v_tenant_id
          ))) /* 00449_PRODUCT_MODIFIERS_REPLACE_CATEGORY */';
begin
  if v_current is null or v_backup is null then raise exception 'FNB_00449_ROLLBACK_PREREQUISITE_MISSING'; end if;
  v_backup := replace(v_backup, 'FUNCTION public._fnb_send_to_kitchen_impl_before_00449(', 'FUNCTION public._fnb_send_to_kitchen_impl_00303(');
  if replace(v_current, v_new, v_old) <> v_backup then raise exception 'FNB_00449_ROLLBACK_LATER_CHANGE_DETECTED'; end if;
  execute v_backup;
end
$rollback$;
commit;
