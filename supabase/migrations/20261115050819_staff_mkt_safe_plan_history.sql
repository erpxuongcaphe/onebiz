-- Keep plan history available after direct audit_log reads are retired.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
alter function private.staff_audit_entity_allowed(text,uuid) rename to staff_audit_entity_allowed_base;
create function private.staff_audit_entity_allowed(p_type text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid;
begin
 if p_type <> 'mkt_channel_plan' then
  return private.staff_audit_entity_allowed_base(p_type,p_id);
 end if;
 select p.tenant_id into tenant from public.profiles p where p.id=actor and coalesce(p.is_active,false);
 return coalesce(tenant is not null and exists(
  select 1 from public.mkt_channel_plans p
  where p.id=p_id and p.tenant_id=tenant and public.mkt_can_read_plan(p.id)
 ),false);
end$$;
revoke all on function private.staff_audit_entity_allowed(text,uuid) from public,anon,authenticated;
commit;
