-- 00354 added except policies to the public wrapper, but retained the old
-- only-list check in its private 00353 delegate. Respect the same policy there.
begin;
set local lock_timeout='2s';
set local statement_timeout='10s';
do $patch$
declare
  signature regprocedure := 'public._fnb_send_to_kitchen_impl_00353(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'::regprocedure;
  definition text;
  old_guard text := E'if exists (\n        select 1 from public.fnb_product_branch_menu_scopes s';
  new_guard text := E'if not exists (\n        select 1 from public.fnb_product_branch_menu_policies policy\n         where policy.tenant_id = v_tenant and policy.product_id = v_product_id\n           and policy.mode = ''except''\n      ) and exists (\n        select 1 from public.fnb_product_branch_menu_scopes s';
begin
  definition := replace(pg_get_functiondef(signature), E'\r\n', E'\n');
  if position(new_guard in definition)>0 then return; end if;
  if position(old_guard in definition)=0
     or position('_fnb_send_to_kitchen_impl_00350' in definition)=0
     or position('FNB_MENU_SCOPE_PRODUCT_NOT_AVAILABLE' in definition)=0
     or (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard)<>1 then
    raise exception 'FNB_LEGACY_MENU_GUARD_CHANGED';
  end if;
  -- The outer 00354 wrapper still enforces except exclusions. The private
  -- delegate keeps every original auth, tenant, size, recipe and price check.
  execute replace(definition,old_guard,new_guard);
end;
$patch$;
commit;
