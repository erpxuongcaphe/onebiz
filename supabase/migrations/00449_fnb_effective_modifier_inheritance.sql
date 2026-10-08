-- Match POS: any product links replace category links; without product links,
-- inherit category groups. Keep required rules, variants, prices and stock checks.
begin;
do $patch$
declare
  v_target regprocedure := to_regprocedure('public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)');
  v_definition text;
  v_backup text;
  v_old text := '(pmg.id is not null or cmg.id is not null)';
  v_new text := '(pmg.id is not null or (cmg.id is not null and not exists (
            select 1 from public.product_modifier_groups own_link
             where own_link.product_id = v_product.id
               and own_link.tenant_id = v_tenant_id
          ))) /* 00449_PRODUCT_MODIFIERS_REPLACE_CATEGORY */';
begin
  if v_target is null then raise exception 'FNB_00449_PREREQUISITE_MISSING'; end if;
  v_definition := pg_get_functiondef(v_target);
  if position('00449_PRODUCT_MODIFIERS_REPLACE_CATEGORY' in v_definition) > 0 then return; end if;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 2
     or position('00377_VARIANT_SATISFIES_LEGACY_SIZE' in v_definition) = 0 then
    raise exception 'FNB_00449_PREREQUISITE_CHANGED';
  end if;
  if to_regprocedure('public._fnb_send_to_kitchen_impl_before_00449(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)') is not null then
    raise exception 'FNB_00449_BACKUP_ALREADY_EXISTS';
  end if;
  v_backup := replace(v_definition, 'FUNCTION public._fnb_send_to_kitchen_impl_00303(', 'FUNCTION public._fnb_send_to_kitchen_impl_before_00449(');
  if v_backup = v_definition then raise exception 'FNB_00449_BACKUP_REWRITE_FAILED'; end if;
  execute v_backup;
  execute replace(v_definition, v_old, v_new);
end
$patch$;
revoke all on function public._fnb_send_to_kitchen_impl_before_00449(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid) from public, anon, authenticated, service_role;
commit;
