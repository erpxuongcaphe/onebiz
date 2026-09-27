-- Disposable PostgreSQL integration check for the final source-type validation.
-- Run only after the 00397-00400 fixtures; never use an application database.
\set ON_ERROR_STOP on

do $$
declare
  v_caught boolean := false;
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = to_regclass('public.fnb_branch_product_cost_events')
      and c.conname = 'fnb_branch_product_cost_events_source_type_check'
      and not c.convalidated
  ) then
    raise exception 'source type allowlist should remain NOT VALID before final migration';
  end if;

  begin
    insert into public.fnb_branch_product_cost_events (
      id, tenant_id, branch_id, product_id, direction, source_type,
      source_reference_type, source_reference_id, quantity, unit_cost, total_cost
    ) values (
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      'in', 'unsupported_source', 'fixture', gen_random_uuid(), 1, 1, 1
    );
  exception when check_violation then
    v_caught := true;
  end;

  if not v_caught then
    raise exception 'NOT VALID source type allowlist did not reject an invalid new write';
  end if;
end;
$$;

\ir ../migrations/00401_validate_fnb_branch_cost_event_source_type.sql

do $$
declare
  v_caught boolean := false;
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = to_regclass('public.fnb_branch_product_cost_events')
      and c.conname = 'fnb_branch_product_cost_events_source_type_check'
      and c.convalidated
  ) then
    raise exception 'source type allowlist was not validated';
  end if;

  begin
    insert into public.fnb_branch_product_cost_events (
      id, tenant_id, branch_id, product_id, direction, source_type,
      source_reference_type, source_reference_id, quantity, unit_cost, total_cost
    ) values (
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      'in', 'unsupported_source', 'fixture', gen_random_uuid(), 1, 1, 1
    );
  exception when check_violation then
    v_caught := true;
  end;

  if not v_caught then
    raise exception 'unsupported source type was accepted after validation';
  end if;
end;
$$;
