-- Prepare readiness checks by assigned branch. Account-wide override remains
-- independent, and items with no branch still require an account-wide grant.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$declare item record;begin
 for item in select * from (values
  ('public.mkt_can_confirm_readiness(uuid,text,uuid)','a29844909e7425d256e39d2e27384dce'),
  ('public.mkt_remind_readiness_item(uuid,uuid)','1b28bcb77f91d5c76aaff87d5752f7f3')
 ) as expected(signature,source_hash) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature) and p.prosecdef
    and md5(replace(p.prosrc,chr(13),''))=item.source_hash) then raise exception 'MKT_READINESS_BASELINE_CHANGED: %',item.signature;end if;
 end loop;
end$$;
create or replace function public.mkt_can_confirm_readiness(p_user_id uuid,p_required_role text,p_required_branch_id uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_user_id and coalesce(p.is_active,true)
  and (public.user_has_permission(p.id,'mkt.override_campaign') or (
   public.mkt_readiness_permission(p_required_role) is not null and
   case when p_required_branch_id is null then public.user_has_permission(p.id,public.mkt_readiness_permission(p_required_role))
    else exists(select 1 from public.branches b where b.id=p_required_branch_id and b.tenant_id=p.tenant_id)
     and public.user_has_branch_access(p.id,p_required_branch_id)
     and public._staff_permission_at_scope(p.id,public.mkt_readiness_permission(p_required_role),p_required_branch_id)
   end)))
$$;
do $$declare source text;patched text;old_gate text;begin
 select replace(pg_get_functiondef('public.mkt_remind_readiness_item(uuid,uuid)'::regprocedure),chr(13),'') into source;
 old_gate:=$old$and (
        public.user_has_permission(p.id, 'mkt.override_campaign')
        or (
          public.user_has_permission(p.id, v_permission)
          and (
            v_item.required_branch_id is null
            or p.branch_id = v_item.required_branch_id
          )
        )
      )$old$;
 patched:=replace(source,old_gate,'and public.mkt_can_confirm_readiness(p.id,v_item.required_role,v_item.required_branch_id)');
 if patched=source then raise exception 'MKT_READINESS_REMINDER_GATE_CHANGED';end if;
 execute patched;
end$$;
create function public.mkt_confirmable_readiness_ids(p_campaign_id uuid)
returns uuid[] language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();tenant uuid;result uuid[];
begin
 if actor is null then raise exception 'UNAUTHENTICATED';end if;
 select p.tenant_id into tenant from public.profiles p where p.id=actor and p.is_active;
 if tenant is null then return '{}'::uuid[];end if;
 select coalesce(array_agg(i.id),'{}'::uuid[]) into result from public.mkt_campaign_readiness_items i
 where i.tenant_id=tenant and i.campaign_id=p_campaign_id and i.deleted_at is null
  and public.mkt_can_confirm_readiness(actor,i.required_role,i.required_branch_id);
 return result;
end$$;
revoke all on function public.mkt_confirmable_readiness_ids(uuid) from public,anon;
grant execute on function public.mkt_confirmable_readiness_ids(uuid) to authenticated;
-- Publication is atomic with the server and reminder checks above.
insert into public.staff_branch_permission_catalog(permission_code,enforcement_version) values
 ('mkt.readiness.finance',1),('mkt.readiness.ops',1),('mkt.readiness.warehouse',1),
 ('mkt.readiness.store',1),('mkt.readiness.ceo',1);
commit;
