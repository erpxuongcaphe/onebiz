-- Apply only after every active client has switched to the scoped readers.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $$begin
 if to_regprocedure('public.staff_audit_entity_history(text,uuid,integer)') is null
    or to_regprocedure('private.staff_audit_entity_allowed_base(text,uuid)') is null
    or not exists (select 1 from pg_catalog.pg_proc p where p.oid=to_regprocedure('private.staff_audit_entity_allowed(text,uuid)') and p.prosrc like '%mkt_channel_plan%') then
  raise exception 'SCOPED_AUDIT_READERS_NOT_READY';
 end if;
end$$;
revoke select on public.audit_log from authenticated;
commit;
