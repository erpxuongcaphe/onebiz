-- Local-only regression checks for migration 00173.
-- Run against `supabase start`; the transaction is always rolled back.
begin;

do $test$
declare
  v_def text;
begin
  select pg_get_functiondef('public.mkt_accept_task(uuid)'::regprocedure)
    into v_def;
  if v_def not like '%raise exception ''ALREADY_PROCESSED''%' then
    raise exception 'mkt_accept_task duplicate guard is missing';
  end if;

  select pg_get_functiondef('public.mkt_mark_task_done(uuid)'::regprocedure)
    into v_def;
  if v_def not like '%acceptance_status <> ''accepted''%'
     or v_def not like '%task_status <> ''doing''%' then
    raise exception 'mkt_mark_task_done state guard is missing';
  end if;

  select pg_get_functiondef('public.mkt_review_content(uuid,uuid,text,text)'::regprocedure)
    into v_def;
  if v_def not like '%content_status <> ''pending_review''%'
     or v_def not like '%version_number = v_content.current_version%'
     or v_def not like '%mkt_complete_task_internal%'
     or v_def not like '%v_required_role in (''ceo'', ''owner'')%'
     or v_def not like '%risk_level in (''high'', ''critical'')%' then
    raise exception 'mkt_review_content current-version/completion guard is missing';
  end if;

  select pg_get_functiondef('public.mkt_claim_outbox_events(integer,uuid)'::regprocedure)
    into v_def;
  if v_def not like '%FOR UPDATE SKIP LOCKED%' then
    raise exception 'outbox claim is not concurrency safe';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.mkt_claim_outbox_events(integer,uuid)',
    'execute'
  ) then
    raise exception 'authenticated must not claim outbox events';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mkt_outbox_events'::regclass
      and conname = 'mkt_outbox_events_status_check'
      and pg_get_constraintdef(oid) like '%processing%'
  ) then
    raise exception 'outbox processing state constraint is missing';
  end if;
end
$test$;

rollback;
