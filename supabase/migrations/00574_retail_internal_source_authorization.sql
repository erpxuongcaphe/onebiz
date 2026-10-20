-- Warehouse internal sales authorize the exporting cashier at the source.
-- Do not grant destination branch access or change receiving/F&B processing.
begin;
set local lock_timeout = '3s';
do $patch$
declare
 target regprocedure;
 definition text;
 old_guard text;
 new_guard text;
begin
 target := 'public.checkout_internal_pos_v2(jsonb)'::regprocedure;
 definition := replace(pg_get_functiondef(target), E'\r\n', E'\n');
 if position('retail_internal_source_00574' in definition) = 0 then
  old_guard := $old$ select branch_id into v_dest from customers where id=v_customer and tenant_id=v_tenant and is_internal;
 if v_dest is null or v_dest=v_branch or not user_has_branch_access(v_actor,v_dest) then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;$old$;
  new_guard := $new$ -- retail_internal_source_00574
 select c.branch_id into v_dest from public.customers c
 join public.branches b on b.id=c.branch_id and b.tenant_id=c.tenant_id and b.is_active
 where c.id=v_customer and c.tenant_id=v_tenant and c.is_internal and c.is_active;
 if v_dest is null or v_dest=v_branch then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;
 if not public.user_has_branch_access(v_actor,v_dest) and not exists (
  select 1 from public.branches b where b.id=v_branch and b.tenant_id=v_tenant
   and b.is_active and b.branch_type='warehouse'
 ) then raise exception 'INTERNAL_POS_CUSTOMER_INVALID'; end if;$new$;
  old_guard := replace(old_guard, E'\r\n', E'\n');
  new_guard := replace(new_guard, E'\r\n', E'\n');
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
   raise exception 'RETAIL_INTERNAL_00574_CHECKOUT_GUARD_CHANGED';
  end if;
  execute replace(definition,old_guard,new_guard);
 end if;
 target := 'public._create_internal_sale_auth_impl_00243(uuid,uuid,uuid,uuid,uuid,text,uuid,text,jsonb,text,boolean,text)'::regprocedure;
 definition := replace(pg_get_functiondef(target), E'\r\n', E'\n');
 if position('retail_internal_source_00574' in definition) = 0 then
  old_guard := $old$  if not public.user_has_branch_access(v_actor, p_from_branch_id)
     or not public.user_has_branch_access(v_actor, p_to_branch_id) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;$old$;
  new_guard := $new$  -- retail_internal_source_00574: warehouse export is not destination POS access.
  if not public.user_has_branch_access(v_actor, p_from_branch_id)
     or (not public.user_has_branch_access(v_actor, p_to_branch_id) and not exists (
       select 1 from public.branches src join public.branches dst on dst.tenant_id=src.tenant_id
       where src.id=p_from_branch_id and src.tenant_id=v_tenant_id
         and src.is_active and src.branch_type='warehouse'
         and dst.id=p_to_branch_id and dst.is_active
     )) then
    raise exception 'BRANCH_ACCESS_DENIED' using errcode = 'P0001';
  end if;$new$;
  old_guard := replace(old_guard, E'\r\n', E'\n');
  new_guard := replace(new_guard, E'\r\n', E'\n');
  if (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1 then
   raise exception 'RETAIL_INTERNAL_00574_ATOMIC_GUARD_CHANGED';
  end if;
  execute replace(definition,old_guard,new_guard);
 end if;
end $patch$;
notify pgrst, 'reload schema';
commit;
