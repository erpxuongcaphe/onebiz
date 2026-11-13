begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

-- The stored invoice session is UUID; preserve the public RPC's text inputs
-- while converting them at the database boundary. This also preserves the
-- existing session uniqueness and retry checks. Invalid IDs fail closed.
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
        'v_session_id uuid := nullif(p_client_session_id, '''')::uuid;');
    elsif f.proname in ('pos_complete_checkout_atomic_v2','pos_complete_checkout_atomic_v3') then
      new_definition:=replace(new_definition,
        'i.client_session_id = nullif(p_client_session_id, '''')',
        'i.client_session_id = nullif(p_client_session_id, '''')::uuid');
    else
      new_definition:=replace(new_definition,
        'i.client_session_id = p_client_session_id',
        'i.client_session_id = nullif(p_client_session_id, '''')::uuid');
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
