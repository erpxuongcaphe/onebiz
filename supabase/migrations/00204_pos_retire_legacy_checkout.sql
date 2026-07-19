-- 00204: Retire client access to legacy POS checkout RPCs.
-- Run only after the application using migration 00203 is live and verified.
-- Permission-only migration. It does not update or delete business data.

revoke all on function public.pos_complete_checkout_atomic(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, numeric, numeric,
  numeric, numeric, text, text, uuid, uuid, numeric, numeric, text
) from public, anon, authenticated;
grant execute on function public.pos_complete_checkout_atomic(
  uuid, uuid, uuid, uuid, text, jsonb, text, jsonb, numeric, numeric,
  numeric, numeric, text, text, uuid, uuid, numeric, numeric, text
) to service_role;

revoke all on function public.complete_draft_atomic(
  uuid, uuid, uuid, uuid, text, numeric, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.complete_draft_atomic(
  uuid, uuid, uuid, uuid, text, numeric, jsonb, uuid
) to service_role;

notify pgrst, 'reload schema';

-- Read-only verification after applying:
-- select
--   not has_function_privilege(
--     'authenticated',
--     'public.pos_complete_checkout_atomic(uuid,uuid,uuid,uuid,text,jsonb,text,jsonb,numeric,numeric,numeric,numeric,text,text,uuid,uuid,numeric,numeric,text)',
--     'EXECUTE'
--   ) as legacy_pos_client_blocked,
--   not has_function_privilege(
--     'authenticated',
--     'public.complete_draft_atomic(uuid,uuid,uuid,uuid,text,numeric,jsonb,uuid)',
--     'EXECUTE'
--   ) as legacy_draft_client_blocked;
