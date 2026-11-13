begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Legacy POS replay lookup runs as SECURITY DEFINER. Apply the same scoped
-- invoice-header guard used by direct reads while preserving trusted server
-- calls and the return shape required by older POS sessions.
do $migration$
declare
  original text;
  anchor constant text := 'WHERE tenant_id = p_tenant_id';
  patched text;
begin
  original := pg_get_functiondef('public.find_invoice_by_session_id(uuid,uuid)'::regprocedure);
  if position(anchor in original) = 0
     or position('client_session_id = p_client_session_id' in original) = 0
     or position('_staff_invoice_header_read' in original) <> 0 then
    raise exception 'STAFF_INVOICE_SESSION_LOOKUP_CHANGED';
  end if;
  patched := replace(original, anchor,
    anchor || E'\n    AND (auth.role() = ''service_role'' OR public._staff_invoice_header_read(tenant_id, branch_id, source))');
  execute patched;
end
$migration$;
commit;
