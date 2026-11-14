-- History marker for the management API release; the prior migration does the work.
do $$begin
 if not exists(select 1 from public.staff_branch_permission_catalog where permission_code='production.manage_bom')
  or to_regprocedure('public._staff_bom_write_allowed(uuid,uuid)') is null
  or (select count(*) from pg_policies where schemaname='public' and policyname in (
   'staff_bom_insert_scope','staff_bom_update_scope','staff_bom_delete_scope',
   'staff_bom_items_insert_scope','staff_bom_items_update_scope','staff_bom_items_delete_scope',
   'staff_bom_option_insert_scope','staff_bom_option_update_scope','staff_bom_option_delete_scope'))<>9 then
  raise exception 'BOM_BRANCH_RELEASE_INCOMPLETE';
 end if;
end$$;
