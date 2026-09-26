-- PostgREST 14 can automatically retry SQLSTATE 40001 responses. These
-- application-level conflicts are not transient serialization failures, so
-- return HTTP 409 via PT409 without changing any business guards or data.
-- Fail closed if a deployed function does not match the audited source shape.
do $migration$
declare
  v_target record;
  v_function_oid oid;
  v_source text;
  v_definition text;
  v_rewritten_definition text;
  v_40001_count integer;
  v_pt409_count_before integer;
  v_pt409_count_after integer;
begin
  for v_target in
    select *
    from (values
      (
        'public.save_pos_draft_atomic_v3(uuid,uuid,jsonb,text,numeric,numeric,numeric,text,text,boolean,uuid,bigint)',
        'POS_DRAFT_NOT_FOUND',
        4
      ),
      (
        'public.adopt_pos_draft_session_atomic_v2(uuid,text,bigint)',
        'POS_DRAFT_NOT_FOUND',
        2
      ),
      (
        'public.complete_draft_atomic_v5(uuid,uuid,jsonb,text,numeric,jsonb,uuid,uuid,text,integer,text,numeric,uuid,text,numeric,numeric,boolean,numeric,numeric,text,bigint,numeric)',
        'POS_DRAFT_NOT_FOUND',
        5
      ),
      (
        'public.split_kitchen_order_atomic(uuid,text,uuid[],integer)',
        'SPLIT_CONCURRENT_CHANGE',
        2
      ),
      (
        'public.update_shipping_order_status_atomic(uuid,text,text)',
        'SHIPPING_STATUS_CONCURRENT_CHANGE',
        1
      ),
      (
        'public._finalize_shift_atomic_00298(uuid,numeric,text,text)',
        'SHIFT_STATE_CHANGED',
        2
      ),
      (
        'public.close_shift_atomic(uuid,numeric,text)',
        'SHIFT_NOT_OPEN',
        1
      ),
      (
        'public.reconcile_pending_shift(uuid,numeric,text,text)',
        'SHIFT_NOT_PENDING_RECONCILE',
        1
      )
    ) as targets(function_signature, required_message, expected_40001_count)
  loop
    v_function_oid := to_regprocedure(v_target.function_signature);
    if v_function_oid is null then
      raise exception 'Expected RPC function is missing: %', v_target.function_signature;
    end if;

    select p.prosrc
      into v_source
      from pg_proc as p
     where p.oid = v_function_oid;

    if position(v_target.required_message in v_source) = 0 then
      raise exception 'RPC source no longer matches audited guard %: %',
        v_target.required_message, v_target.function_signature;
    end if;

    select count(*)
      into v_40001_count
      from regexp_matches(
        v_source,
        'errcode[[:space:]]*=[[:space:]]*''40001''',
        'gi'
      );

    if v_40001_count <> v_target.expected_40001_count then
      raise exception 'Unexpected SQLSTATE 40001 count for %: expected %, found %',
        v_target.function_signature,
        v_target.expected_40001_count,
        v_40001_count;
    end if;

    select count(*)
      into v_pt409_count_before
      from regexp_matches(
        v_source,
        'errcode[[:space:]]*=[[:space:]]*''PT409''',
        'gi'
      );

    v_definition := pg_get_functiondef(v_function_oid);
    v_rewritten_definition := regexp_replace(
      v_definition,
      'errcode[[:space:]]*=[[:space:]]*''40001''',
      $replacement$errcode = 'PT409'$replacement$,
      'gi'
    );

    if v_rewritten_definition = v_definition then
      raise exception 'No SQLSTATE replacements were made for %',
        v_target.function_signature;
    end if;

    execute v_rewritten_definition;

    select p.prosrc
      into v_source
      from pg_proc as p
     where p.oid = v_function_oid;

    if v_source ~* 'errcode[[:space:]]*=[[:space:]]*''40001''' then
      raise exception 'SQLSTATE 40001 remains in % after replacement',
        v_target.function_signature;
    end if;

    select count(*)
      into v_pt409_count_after
      from regexp_matches(
        v_source,
        'errcode[[:space:]]*=[[:space:]]*''PT409''',
        'gi'
      );

    if v_pt409_count_after <> v_pt409_count_before + v_target.expected_40001_count then
      raise exception 'PT409 verification failed for %: expected %, found %',
        v_target.function_signature,
        v_pt409_count_before + v_target.expected_40001_count,
        v_pt409_count_after;
    end if;
  end loop;
end;
$migration$;
