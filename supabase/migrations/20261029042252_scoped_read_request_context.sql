-- Cache branch authorization per request, never per invoice/movement row.
-- Existing authorization helper, cost permission, view columns/ACL/barrier stay in force.
begin;
do $migration$
declare
 v_name text; v_table text; v_definition text; v_old text; v_new text;
 v_acl text; v_owner oid; v_options text[];
begin
 foreach v_name in array array['invoice_items_scoped','stock_movements_scoped'] loop
  select pg_get_viewdef(c.oid,true),c.relacl::text,c.relowner,c.reloptions
    into strict v_definition,v_acl,v_owner,v_options
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_name and c.relkind='v';
  if position('_request_branch_candidates_20261029' in v_definition)>0 then continue; end if;
  v_old := case when v_name='invoice_items_scoped'
    then '_can_read_branch_inventory_00476(auth.uid(), o.tenant_id, o.branch_id)'
    else '_can_read_branch_inventory_00476(auth.uid(), tenant_id, branch_id)' end;
  v_new := case when v_name='invoice_items_scoped'
    then '(EXISTS (SELECT 1 FROM _request_allowed_branches_20261029 access WHERE access.tenant_id=o.tenant_id AND access.branch_id IS NOT DISTINCT FROM o.branch_id))'
    else '(EXISTS (SELECT 1 FROM _request_allowed_branches_20261029 access WHERE access.tenant_id=t.tenant_id AND access.branch_id IS NOT DISTINCT FROM t.branch_id))' end;
  if (length(v_definition)-length(replace(v_definition,v_old,'')))/length(v_old)<>1 then
    raise exception 'Unexpected authorization definition for %',v_name;
  end if;
  v_definition := replace(v_definition,v_old,v_new);
  v_old := 'user_has_permission(auth.uid(), ''products.view_cost''::text)';
  if position(v_old in v_definition)=0 then raise exception 'Missing cost redaction in %',v_name; end if;
  v_definition := replace(v_definition,v_old,'(SELECT public.user_has_permission(auth.uid(), ''products.view_cost''::text))');
  v_table := case when v_name='invoice_items_scoped' then 'invoices' else 'stock_movements' end;
  v_definition := format('WITH _request_branch_candidates_20261029 AS MATERIALIZED (
    SELECT DISTINCT tenant_id,branch_id FROM public.%I
    WHERE tenant_id=(SELECT public.get_user_tenant_id())
  ), _request_allowed_branches_20261029 AS MATERIALIZED (
    SELECT tenant_id,branch_id FROM _request_branch_candidates_20261029
    WHERE public._can_read_branch_inventory_00476((SELECT auth.uid()),tenant_id,branch_id)
  ) %s',v_table,v_definition);
  execute format('CREATE OR REPLACE VIEW public.%I %s AS %s',v_name,
    case when v_options is null then '' else 'WITH ('||array_to_string(v_options,',')||')' end,v_definition);
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_name
    and (c.relacl::text is distinct from v_acl or c.relowner<>v_owner or c.reloptions is distinct from v_options)) then
    raise exception 'View ACL/owner/security options changed for %',v_name;
  end if;
 end loop;
end $migration$;
notify pgrst,'reload schema';
commit;
