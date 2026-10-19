-- Fix an audit actor omission only. Physical stock and negative-sale policy
-- remain authoritative; an unavailable lot stays an operational warning.
begin;
set local lock_timeout='3s';

create or replace function public._allocate_fnb_sale_lots_00563(
 p_tenant_id uuid,p_product_id uuid,p_branch_id uuid,p_quantity numeric,
 p_source_type text,p_source_id uuid,p_allocated_by uuid default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;shortage numeric;actor uuid:=coalesce(p_allocated_by,auth.uid());
begin
 -- lot_audit_actor_00568: retain the authenticated/explicit checkout actor.
 -- Trusted background posting can use the already-created invoice author.
 if actor is null and p_source_type='invoice' then
   select created_by into actor from public.invoices
   where id=p_source_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 end if;
 result:=public.allocate_lots_fifo(p_tenant_id,p_product_id,p_branch_id,p_quantity,p_source_type,p_source_id,actor);
 shortage:=(result->>'remaining')::numeric;
 if shortage>0 then
   if actor is null then raise exception 'FNB_LOT_AUDIT_ACTOR_REQUIRED' using errcode='22023'; end if;
   insert into public.audit_log(tenant_id,user_id,action,entity_type,entity_id,new_data)
   values(p_tenant_id,actor,'fnb_sale_lot_allocation_shortfall','invoice',p_source_id,
   jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'requested',p_quantity,
   'allocated_quantity',p_quantity-shortage,'unallocated_quantity',shortage,'reason','NO_ELIGIBLE_LOT','stock_policy_unchanged',true));
 end if;
 return result;
end $$;

do $actor_patch$
declare fn record;definition text;patched text;calls integer;
begin
 for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('consume_bom_for_sale','_fnb_complete_payment_impl_00230') loop
   definition:=pg_get_functiondef(fn.oid);
   if strpos(definition,'lot_audit_actor_00568')>0 then continue; end if;
   select count(*) into calls from regexp_matches(definition,
     'perform public\._allocate_fnb_sale_lots_00563\(([^;]+)\);','g');
   if calls<>(case when fn.proname='consume_bom_for_sale' then 2 else 4 end)
   then raise exception 'FNB_00568_ALLOCATION_CALL_BOUNDARY_CHANGED: % (%)',fn.proname,calls; end if;
   patched:=regexp_replace(definition,
     'perform public\._allocate_fnb_sale_lots_00563\(([^;]+)\);',
     'perform public._allocate_fnb_sale_lots_00563(\1,p_created_by); -- lot_audit_actor_00568','g');
   execute patched;
 end loop;
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='consume_bom_for_sale')
 or not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_fnb_complete_payment_impl_00230')
 then raise exception 'FNB_00568_CHECKOUT_PREREQUISITE_MISSING'; end if;
end $actor_patch$;

-- Keep this internal-only helper inaccessible as a direct public RPC.
revoke all on function public._allocate_fnb_sale_lots_00563(uuid,uuid,uuid,numeric,text,uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;