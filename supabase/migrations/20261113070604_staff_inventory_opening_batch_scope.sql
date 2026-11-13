-- Preserve the legacy tenant, active-profile and branch requirements. Resolve
-- the already-supported adjustment permission at the batch's own branch.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public._staff_my_inventory_adjust(p_branch uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and public._staff_permission_at_scope(auth.uid(),'inventory.adjust',p_branch)
$$;
revoke all on function public._staff_my_inventory_adjust(uuid) from public,anon;
grant execute on function public._staff_my_inventory_adjust(uuid) to authenticated;

do $migration$
declare original text;
begin
 select p.qual into original from pg_catalog.pg_policies p
  where p.schemaname='public' and p.tablename='inventory_opening_batches'
   and p.policyname='inventory_opening_batches_read' and p.cmd='SELECT';
 if original is null or position('inventory.adjust' in original)=0
  or position('user_has_branch_access' in original)=0 or position('is_active' in original)=0
  then raise exception 'STAFF_INVENTORY_OPENING_POLICY_CHANGED';end if;
end $migration$;

alter policy inventory_opening_batches_read on public.inventory_opening_batches using (
 tenant_id=(select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and coalesce(p.is_active,true))
 and public.user_has_branch_access((select auth.uid()),branch_id)
 and public._staff_my_inventory_adjust(branch_id)
);
commit;
