-- 00210: Let the audit executor resolve Supabase's uuid-ossp functions.
-- This only changes the Audit Runner function configuration. It does not
-- read, update, or delete business data.

alter function public.mkt_audit_execute_scenario(uuid, text)
  set search_path = public, extensions;

notify pgrst, 'reload schema';