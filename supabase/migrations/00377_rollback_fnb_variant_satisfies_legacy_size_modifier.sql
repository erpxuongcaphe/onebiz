-- Restore the exact private FnB implementation saved by 00377.
-- This does not change products, prices, inventory or any Retail function.
begin;

do $rollback$
declare
  v_current constant text :=
    'public._fnb_send_to_kitchen_impl_00303(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)';
  v_backup constant text :=
    'public._fnb_send_to_kitchen_impl_before_00377(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)';
  v_definition text;
begin
  if to_regprocedure(v_backup) is null then
    if to_regprocedure(v_current) is not null
       and position('00377_VARIANT_SATISFIES_LEGACY_SIZE' in pg_get_functiondef(to_regprocedure(v_current))) = 0 then
      return;
    end if;
    raise exception using errcode = 'P0001', message = 'FNB_00377_ROLLBACK_BACKUP_MISSING';
  end if;

  v_definition := pg_get_functiondef(to_regprocedure(v_backup));
  v_definition := regexp_replace(
    v_definition,
    'FUNCTION public\._fnb_send_to_kitchen_impl_before_00377\(',
    'FUNCTION public._fnb_send_to_kitchen_impl_00303(',
    'i'
  );
  if position('FUNCTION public._fnb_send_to_kitchen_impl_00303(' in v_definition) = 0 then
    raise exception using errcode = 'P0001', message = 'FNB_00377_ROLLBACK_REWRITE_FAILED';
  end if;
  execute v_definition;
  execute 'drop function public._fnb_send_to_kitchen_impl_before_00377(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)';

  alter function public._fnb_send_to_kitchen_impl_00303(
    uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
  ) owner to postgres;
  revoke all on function public._fnb_send_to_kitchen_impl_00303(
    uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid
  ) from public, anon, authenticated, service_role;
end;
$rollback$;

commit;

notify pgrst, 'reload schema';
