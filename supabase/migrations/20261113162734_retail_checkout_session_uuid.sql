begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- The stored invoice session is UUID; preserve the public RPC's text inputs
-- while converting them at the database boundary. Legacy browser fallbacks
-- used non-UUID session strings; map those deterministically to a UUID so a
-- retry still resolves to the same invoice.
create function public._retail_session_uuid(p_session text)
returns uuid language sql immutable set search_path='' as $$
  select case
    when nullif(p_session,'') is null then null
    when p_session ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_session::uuid
    else extensions.uuid_generate_v5('530852da-8b88-5b8f-845c-03de9a5b9de6'::uuid,p_session)
  end
$$;
revoke all on function public._retail_session_uuid(text) from public,anon,authenticated;
do $patch$
declare f record; old_definition text; new_definition text; patched_count integer:=0;
begin
  if not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='invoices'
      and column_name='client_session_id' and data_type='uuid') then
    raise exception 'RETAIL_SESSION_COLUMN_TYPE_CHANGED';
  end if;
  for f in select p.oid,p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('pos_complete_checkout_atomic','pos_complete_checkout_atomic_v2',
       'pos_complete_checkout_atomic_v3','pos_complete_checkout_atomic_v4')
  loop
    old_definition:=pg_get_functiondef(f.oid);
    new_definition:=old_definition;
    if f.proname='pos_complete_checkout_atomic' then
      new_definition:=replace(new_definition,
        'v_session_id text := nullif(p_client_session_id, '''');',
        'v_session_id uuid := public._retail_session_uuid(p_client_session_id);');
    elsif f.proname in ('pos_complete_checkout_atomic_v2','pos_complete_checkout_atomic_v3') then
      new_definition:=replace(new_definition,
        'i.client_session_id = nullif(p_client_session_id, '''')',
        'i.client_session_id = public._retail_session_uuid(p_client_session_id)');
    else
      new_definition:=replace(new_definition,
        'i.client_session_id = p_client_session_id',
        'i.client_session_id = public._retail_session_uuid(p_client_session_id)');
    end if;
    if new_definition=old_definition then
      raise exception 'RETAIL_SESSION_CONSUMER_CHANGED: %',f.proname;
    end if;
    execute new_definition;
    patched_count:=patched_count+1;
  end loop;
  if patched_count<>4 then raise exception 'RETAIL_SESSION_CONSUMERS_MISSING'; end if;
end $patch$;
commit;
