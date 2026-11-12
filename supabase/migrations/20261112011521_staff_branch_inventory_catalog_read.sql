begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  signature text;
  source text;
  permission_anchor constant text := 'public.user_has_permission(actor, ''inventory.view'')';
  branches_anchor constant text := 'where b.tenant_id = tenant and (p_branch_id is null or b.id = p_branch_id)';
begin
  foreach signature in array array[
    'public.get_inventory_catalog_00573(uuid,text,text,text,boolean,integer,integer)',
    'public.get_inventory_catalog_filtered(uuid,text,text,text,boolean,integer,integer,uuid,text,boolean,boolean)'
  ] loop
    source := pg_get_functiondef(signature::regprocedure);
    if position(permission_anchor in source) = 0 or position(branches_anchor in source) = 0 then
      raise exception 'STAFF_INVENTORY_CATALOG_CHANGED: %', signature;
    end if;
    -- Apply permission before balance joins, synthetic zero rows and totals.
    execute replace(
      replace(source, permission_anchor, 'public._staff_my_inventory_view(p_branch_id)'),
      branches_anchor, branches_anchor || ' and public._staff_my_inventory_view(b.id)'
    );
  end loop;
end
$migration$;

commit;
