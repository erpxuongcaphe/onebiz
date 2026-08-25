-- ============================================================================
-- HOAN TAC 00346 - Chi dung khi can khoi phuc khan cap duong ghi KDS cu.
-- Khong sua du lieu nghiep vu. Chi cap lai INSERT/UPDATE/DELETE cho
-- authenticated; anon va PUBLIC van bi chan.
-- ============================================================================

begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.kitchen_orders',
    'public.kitchen_order_items',
    'public.pos_exception_events'
  ] loop
    if to_regclass(v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = 'FNB_00346_ROLLBACK_TABLE_MISSING',
        detail = v_table;
    end if;
  end loop;
end;
$$;

revoke insert, update, delete, truncate on table public.kitchen_orders
  from public, anon;
revoke insert, update, delete, truncate on table public.kitchen_order_items
  from public, anon;
revoke insert, update, delete, truncate on table public.pos_exception_events
  from public, anon;

grant insert, update, delete on table public.kitchen_orders to authenticated;
grant insert, update, delete on table public.kitchen_order_items to authenticated;
grant insert, update, delete on table public.pos_exception_events to authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.kitchen_orders',
    'public.kitchen_order_items',
    'public.pos_exception_events'
  ] loop
    if not has_table_privilege('authenticated', v_table, 'INSERT')
       or not has_table_privilege('authenticated', v_table, 'UPDATE')
       or not has_table_privilege('authenticated', v_table, 'DELETE')
       or has_table_privilege('anon', v_table, 'INSERT')
       or has_table_privilege('anon', v_table, 'UPDATE')
       or has_table_privilege('anon', v_table, 'DELETE') then
      raise exception using
        errcode = 'P0001',
        message = 'FNB_00346_ROLLBACK_GRANT_INVALID',
        detail = v_table;
    end if;
  end loop;
end;
$$;

commit;
notify pgrst, 'reload schema';
