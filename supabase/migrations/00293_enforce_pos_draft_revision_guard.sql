-- ============================================================
-- 00293: Enforce revision-aware retail POS draft writes
-- ============================================================
-- Run only after the 00292-compatible web build is live and old POS tabs have
-- been refreshed. This changes execute permissions only; it changes no data.

revoke execute on function public.save_pos_draft_atomic_v2(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean
) from authenticated;

revoke execute on function public.save_pos_draft_atomic(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, numeric, text, text, boolean
) from authenticated;

revoke execute on function public.adopt_pos_draft_session_atomic(uuid, text)
  from authenticated;

revoke execute on function public.complete_draft_atomic_v4(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text,
  numeric, uuid, text, numeric, numeric, boolean, numeric, numeric
) from authenticated;

grant execute on function public.save_pos_draft_atomic_v3(
  uuid, uuid, jsonb, text, numeric, numeric, numeric, text, text, boolean, uuid, bigint
) to authenticated;
grant execute on function public.adopt_pos_draft_session_atomic_v2(uuid, text, bigint)
  to authenticated;
grant execute on function public.complete_draft_atomic_v5(
  uuid, uuid, jsonb, text, numeric, jsonb, uuid, uuid, text, integer, text,
  numeric, uuid, text, numeric, numeric, boolean, numeric, numeric, text,
  bigint, numeric
) to authenticated;

notify pgrst, 'reload schema';

select
  has_function_privilege(
    'authenticated',
    'public.save_pos_draft_atomic_v3(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean,uuid,bigint)',
    'EXECUTE'
  ) as draft_v3_allowed,
  not has_function_privilege(
    'authenticated',
    'public.save_pos_draft_atomic_v2(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean)',
    'EXECUTE'
  ) as legacy_draft_blocked,
  has_function_privilege(
    'authenticated',
    'public.complete_draft_atomic_v5(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric)',
    'EXECUTE'
  ) as checkout_v5_allowed,
  not has_function_privilege(
    'authenticated',
    'public.complete_draft_atomic_v4(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric)',
    'EXECUTE'
  ) as legacy_checkout_blocked;

