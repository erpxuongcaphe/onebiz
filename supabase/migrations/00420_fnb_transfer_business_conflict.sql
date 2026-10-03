-- Definition-only patch: stale table ownership is a business conflict, not a
-- transient serialization failure. Preserve every guard and function setting.
do $migration$
declare
  v_oid oid := to_regprocedure('public.fnb_transfer_table_atomic(uuid,uuid,uuid,uuid)');
  v_definition text;
  v_old text := 'raise exception using errcode = ''40001'', message = ''FNB_TRANSFER_SOURCE_STALE'';';
  v_new text := 'raise exception using errcode = ''PT409'', message = ''FNB_TRANSFER_SOURCE_STALE'';';
  v_old_count integer;
  v_new_count integer;
begin
  if v_oid is null then
    raise exception 'Expected hardened F&B transfer function is missing';
  end if;
  v_definition := pg_get_functiondef(v_oid);
  v_old_count := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  v_new_count := (length(v_definition) - length(replace(v_definition, v_new, ''))) / length(v_new);
  if v_old_count = 0 and v_new_count = 2 then
    return;
  end if;
  if v_old_count <> 2 or v_new_count <> 0
     or position('v_from_table.current_order_id is distinct from v_order.id' in v_definition) = 0
     or position('user_has_branch_access' in v_definition) = 0
     or position('pos_fnb.transfer_table' in v_definition) = 0 then
    raise exception 'F&B transfer function differs from the audited guard shape';
  end if;
  execute replace(v_definition, v_old, v_new);
  if pg_get_functiondef(v_oid) <> replace(v_definition, v_old, v_new) then
    raise exception 'F&B transfer definition verification failed';
  end if;
end;
$migration$;
