-- Preserve the occupied table when another unpaid split bill still exists.
-- Definition-only migration; no existing business rows are rewritten.
begin;
set local lock_timeout = '3s';
do $$ begin
  if to_regprocedure('public._fnb_cancel_unpaid_order_impl_00066(uuid,text,text,uuid,uuid)') is null
      or to_regprocedure('public.verify_otp_authorization(uuid,text,uuid,uuid)') is null
      or to_regprocedure('public.user_has_branch_access(uuid,uuid)') is null then
    raise exception 'FNB_CANCEL_PREREQUISITES_MISSING: verify the current cancellation/OTP definitions before applying';
  end if;
end $$;

create or replace function public.fnb_cancel_unpaid_order_atomic(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_shift_id uuid default null,
  p_otp_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_tenant_id uuid;
  v_order record;
  v_table record;
  v_approver uuid;
  v_remaining_id uuid;
  v_result jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'AUTH_REQUIRED';
  end if;
  select p.tenant_id into v_tenant_id from public.profiles p
   where p.id = v_actor and coalesce(p.is_active, true);
  if not found or v_tenant_id is null then
    raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED';
  end if;
  select ko.id, ko.tenant_id, ko.branch_id, ko.table_id, ko.invoice_id,
         ko.status, ko.merged_into_id
    into v_order from public.kitchen_orders ko
   where ko.id = p_order_id and ko.tenant_id = v_tenant_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'KITCHEN_ORDER_NOT_FOUND';
  end if;
  if not coalesce(public.user_has_branch_access(v_actor, v_order.branch_id), false) then
    raise exception using errcode = '42501', message = 'FNB_CANCEL_BRANCH_ACCESS_DENIED';
  end if;
  if v_order.invoice_id is not null or v_order.status = 'completed' then
    raise exception using errcode = 'P0001', message = 'ORDER_ALREADY_PAID';
  end if;
  if v_order.merged_into_id is not null then
    raise exception using errcode = 'P0001', message = 'FNB_CANCEL_ORDER_MERGED';
  end if;
  if p_shift_id is not null and not exists (
    select 1 from public.shifts s where s.id = p_shift_id
      and s.tenant_id = v_tenant_id and s.branch_id = v_order.branch_id
      and s.cashier_id = v_actor and s.status = 'open'
  ) then
    raise exception using errcode = '42501', message = 'FNB_CANCEL_SHIFT_NOT_OPEN_FOR_USER_BRANCH';
  end if;
  -- The legacy implementation verifies the action/target and effective cancel
  -- permission. Check the approver's current tenant/branch as well.
  v_approver := case when p_otp_id is null then v_actor else
    public.verify_otp_authorization(p_otp_id, 'fnb.cancel_unpaid_bill', v_actor, p_order_id) end;
  if not exists (select 1 from public.profiles p where p.id = v_approver
      and p.tenant_id = v_tenant_id and coalesce(p.is_active, true))
     or not coalesce(public.user_has_branch_access(v_approver, v_order.branch_id), false) then
    raise exception using errcode = '42501', message = 'FNB_CANCEL_APPROVER_SCOPE_DENIED';
  end if;
  if v_order.table_id is not null then
    select rt.id, rt.tenant_id, rt.branch_id into v_table
      from public.restaurant_tables rt where rt.id = v_order.table_id for update;
    if not found or v_table.tenant_id is distinct from v_tenant_id
       or v_table.branch_id is distinct from v_order.branch_id then
      raise exception using errcode = '42501', message = 'FNB_CANCEL_TABLE_SCOPE_DENIED';
    end if;
  end if;

  v_result := public._fnb_cancel_unpaid_order_impl_00066(
    p_order_id, p_reason_code, p_reason_note, p_shift_id, p_otp_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'FNB_CANCEL_RESULT_INVALID';
  end if;
  if v_order.table_id is not null then
    -- Don't lock sibling orders after the table lock: another cancellation can
    -- already hold its own order and be waiting for this table. The table lock
    -- serializes reconciliation; the next operation sees the committed result.
    select ko.id into v_remaining_id from public.kitchen_orders ko
     where ko.tenant_id = v_tenant_id and ko.branch_id = v_order.branch_id
       and ko.table_id = v_order.table_id and ko.id <> p_order_id
       and ko.invoice_id is null and ko.merged_into_id is null
       and ko.status in ('pending', 'preparing', 'ready', 'served')
     order by ko.created_at, ko.id limit 1;
    update public.restaurant_tables
       set status = case when v_remaining_id is null then 'available' else 'occupied' end,
           current_order_id = v_remaining_id, updated_at = now()
     where id = v_order.table_id and tenant_id = v_tenant_id
       and branch_id = v_order.branch_id;
  end if;
  return v_result || jsonb_build_object('remaining_order_id', v_remaining_id);
end;
$$;
revoke all on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) from public, anon;
grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) to authenticated;
notify pgrst, 'reload schema';
comment on function public.fnb_cancel_unpaid_order_atomic(uuid,text,text,uuid,uuid) is
  'Cancel one unpaid FNB bill atomically, preserving sibling bills and checking the actor/approver branch. No invoice, cash or inventory mutation.';
commit;
