-- ============================================================================
-- 00346 - Khoa ghi truc tiep cho don bep FnB
--
-- Sau 00345, moi giao dich thu ngan va bep phai di qua RPC SECURITY DEFINER.
-- Migration nay chi thu hoi INSERT/UPDATE/DELETE/TRUNCATE tren 3 bang KDS:
--   kitchen_orders, kitchen_order_items, pos_exception_events.
-- KHONG dong vao invoices, invoice_items, cash_transactions, ton kho hay du lieu
-- nghiep vu hien co.
-- ============================================================================

begin;

do $$
declare
  v_sig text;
  v_table text;
begin
  foreach v_sig in array array[
    'public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)',
    'public._fnb_void_invoice_impl_00329(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'public._fnb_complete_payment_impl_00343(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)',
    'public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)',
    'public.fnb_update_kitchen_item_status_v2(uuid,text)',
    'public.fnb_update_kitchen_order_status_v2(uuid,text)',
    'public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)',
    'public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)'
  ] loop
    if to_regprocedure(v_sig) is null then
      raise exception using
        errcode = 'P0001',
        message = 'FNB_00346_REQUIRED_RPC_MISSING',
        detail = v_sig;
    end if;
  end loop;

  if exists (
    select 1
      from pg_proc p
     where p.oid in (
       to_regprocedure('public.fnb_send_to_kitchen_atomic_v2(uuid,uuid,text,text,text,jsonb,text,numeric,numeric,uuid,text,uuid)'),
       to_regprocedure('public.fnb_update_kitchen_item_status_v2(uuid,text)'),
       to_regprocedure('public.fnb_update_kitchen_order_status_v2(uuid,text)'),
       to_regprocedure('public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid)'),
       to_regprocedure('public.fnb_void_invoice_atomic(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)'),
       to_regprocedure('public.fnb_complete_payment_atomic_v3(uuid,uuid,text,text,jsonb,numeric,boolean,numeric,uuid,text,text,uuid,numeric,uuid,text)')
     )
       and (
         not p.prosecdef
         or pg_get_userbyid(p.proowner) <> 'postgres'
         or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
         or has_function_privilege('anon', p.oid, 'EXECUTE')
       )
  ) then
    raise exception using errcode = 'P0001', message = 'FNB_00346_RPC_SECURITY_PREREQUISITE_CHANGED';
  end if;

  foreach v_table in array array[
    'public.kitchen_orders',
    'public.kitchen_order_items',
    'public.pos_exception_events'
  ] loop
    if to_regclass(v_table) is null then
      raise exception using
        errcode = 'P0001',
        message = 'FNB_00346_REQUIRED_TABLE_MISSING',
        detail = v_table;
    end if;
  end loop;
end;
$$;

revoke insert, update, delete, truncate on table public.kitchen_orders
  from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.kitchen_order_items
  from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.pos_exception_events
  from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'public.kitchen_orders',
    'public.kitchen_order_items',
    'public.pos_exception_events'
  ] loop
    if has_table_privilege('authenticated', v_table, 'INSERT')
       or has_table_privilege('authenticated', v_table, 'UPDATE')
       or has_table_privilege('authenticated', v_table, 'DELETE')
       or has_table_privilege('authenticated', v_table, 'TRUNCATE')
       or has_table_privilege('anon', v_table, 'INSERT')
       or has_table_privilege('anon', v_table, 'UPDATE')
       or has_table_privilege('anon', v_table, 'DELETE')
       or has_table_privilege('anon', v_table, 'TRUNCATE') then
      raise exception using
        errcode = 'P0001',
        message = 'FNB_00346_DIRECT_WRITE_REVOKE_FAILED',
        detail = v_table;
    end if;
  end loop;
end;
$$;

commit;
notify pgrst, 'reload schema';
