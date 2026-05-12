-- ============================================================
-- 00059: POS FnB bill control
-- - Separate permissions for unpaid cancel / paid void / sent-order edit
-- - Atomic unpaid kitchen-order cancel with permission check
-- - POS exception event log for shift loss-prevention reports
-- ============================================================

-- 1. Persist cancel metadata on kitchen orders. Existing rows are untouched.
alter table public.kitchen_orders
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_approved_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_kitchen_orders_cancelled_at
  on public.kitchen_orders(tenant_id, branch_id, cancelled_at)
  where status = 'cancelled';

-- 2. Exception events: one table for actions that should be visible in manager/shift reports.
create table if not exists public.pos_exception_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  source text not null default 'fnb',
  event_type text not null,
  target_type text not null,
  target_id uuid not null,
  invoice_id uuid references public.invoices(id) on delete set null,
  kitchen_order_id uuid references public.kitchen_orders(id) on delete set null,
  amount numeric not null default 0,
  reason_code text,
  reason_note text,
  items_snapshot jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  requested_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_pos_exception_events_tenant_created
  on public.pos_exception_events(tenant_id, created_at desc);

create index if not exists idx_pos_exception_events_branch_shift
  on public.pos_exception_events(tenant_id, branch_id, shift_id, created_at desc);

create index if not exists idx_pos_exception_events_type
  on public.pos_exception_events(tenant_id, event_type, created_at desc);

alter table public.pos_exception_events enable row level security;

drop policy if exists "pos_exception_events_select" on public.pos_exception_events;
create policy "pos_exception_events_select" on public.pos_exception_events
  for select using (tenant_id = public.get_user_tenant_id());

drop policy if exists "pos_exception_events_insert" on public.pos_exception_events;
create policy "pos_exception_events_insert" on public.pos_exception_events
  for insert with check (tenant_id = public.get_user_tenant_id());

comment on table public.pos_exception_events is
  'POS exception/audit events: unpaid order cancel, paid bill void, sent item edit, discount override.';

-- 3. Permission helper for SECURITY DEFINER RPCs.
create or replace function public.user_has_permission(
  p_user_id uuid,
  p_permission_code text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = p_user_id
        and p.role = 'owner'
    )
    or exists (
      select 1
      from public.profiles p
      join public.role_permissions rp on rp.role_id = p.role_id
      where p.id = p_user_id
        and rp.permission_code = p_permission_code
    );
$$;

comment on function public.user_has_permission is
  'Server-side RBAC helper for SECURITY DEFINER RPCs. Owner role bypasses all permission rows.';

-- 4. Grant the new finer POS FnB controls to roles that already had pos_fnb.void.
insert into public.role_permissions (role_id, permission_code)
select distinct rp.role_id, v.permission_code
from public.role_permissions rp
cross join (values
  ('pos_fnb.cancel_unpaid_order'),
  ('pos_fnb.void_paid_bill'),
  ('pos_fnb.edit_sent_order')
) as v(permission_code)
where rp.permission_code = 'pos_fnb.void'
on conflict (role_id, permission_code) do nothing;

-- 5. Atomic cancel for sent-but-unpaid FnB orders.
create or replace function public.fnb_cancel_unpaid_order_atomic(
  p_order_id uuid,
  p_reason_code text,
  p_reason_note text default null,
  p_shift_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_order record;
  v_items_snapshot jsonb := '[]'::jsonb;
  v_amount numeric := 0;
  v_note text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED: please sign in before cancelling an FnB order';
  end if;

  select id, tenant_id, branch_id, role
  into v_profile
  from public.profiles
  where id = v_actor
    and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND: %', v_actor;
  end if;

  if not (
    public.user_has_permission(v_actor, 'pos_fnb.cancel_unpaid_order')
    or public.user_has_permission(v_actor, 'pos_fnb.void')
  ) then
    raise exception 'PERMISSION_DENIED: cancelling a sent FnB order requires manager permission';
  end if;

  if nullif(trim(coalesce(p_reason_code, '')), '') is null then
    raise exception 'CANCEL_REASON_REQUIRED';
  end if;

  select id, tenant_id, branch_id, invoice_id, table_id, order_number, status, note
  into v_order
  from public.kitchen_orders
  where id = p_order_id
    and tenant_id = v_profile.tenant_id
  for update;

  if not found then
    raise exception 'KITCHEN_ORDER_NOT_FOUND: %', p_order_id;
  end if;

  if v_order.invoice_id is not null or v_order.status = 'completed' then
    raise exception 'ORDER_ALREADY_PAID: use paid invoice void/refund flow instead';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'ORDER_ALREADY_CANCELLED: %', v_order.order_number;
  end if;

  if p_shift_id is not null and not exists (
    select 1
    from public.shifts
    where id = p_shift_id
      and tenant_id = v_order.tenant_id
      and branch_id = v_order.branch_id
      and status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN_FOR_ORDER_BRANCH: %', p_shift_id;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'item_id', id,
          'product_id', product_id,
          'product_name', product_name,
          'variant_id', variant_id,
          'variant_label', variant_label,
          'quantity', quantity,
          'unit_price', unit_price,
          'note', note,
          'toppings', coalesce(toppings, '[]'::jsonb),
          'status', status
        )
        order by id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(quantity * unit_price), 0)
  into v_items_snapshot, v_amount
  from public.kitchen_order_items
  where kitchen_order_id = p_order_id;

  v_note := trim(
    both from concat_ws(
      ' ',
      nullif(v_order.note, ''),
      '[Hủy: ' || trim(p_reason_code) ||
        case
          when nullif(trim(coalesce(p_reason_note, '')), '') is not null
            then ' - ' || trim(p_reason_note)
          else ''
        end ||
      ']'
    )
  );

  update public.kitchen_orders
  set status = 'cancelled',
      cancel_reason_code = trim(p_reason_code),
      cancel_reason = nullif(trim(coalesce(p_reason_note, '')), ''),
      cancelled_at = now(),
      cancelled_by = v_actor,
      cancel_approved_by = v_actor,
      note = nullif(v_note, ''),
      updated_at = now()
  where id = v_order.id
    and tenant_id = v_order.tenant_id;

  if v_order.table_id is not null then
    update public.restaurant_tables
    set status = 'available',
        current_order_id = null,
        updated_at = now()
    where tenant_id = v_order.tenant_id
      and id = v_order.table_id
      and current_order_id = v_order.id;
  end if;

  insert into public.pos_exception_events (
    tenant_id, branch_id, shift_id, source, event_type,
    target_type, target_id, kitchen_order_id, amount,
    reason_code, reason_note, items_snapshot, metadata,
    requested_by, approved_by
  ) values (
    v_order.tenant_id, v_order.branch_id, p_shift_id, 'fnb', 'unpaid_order_cancel',
    'kitchen_order', v_order.id, v_order.id, v_amount,
    trim(p_reason_code), nullif(trim(coalesce(p_reason_note, '')), ''),
    v_items_snapshot,
    jsonb_build_object(
      'order_number', v_order.order_number,
      'previous_status', v_order.status,
      'table_id', v_order.table_id
    ),
    v_actor, v_actor
  );

  return jsonb_build_object(
    'success', true,
    'kitchen_order_id', v_order.id,
    'order_number', v_order.order_number,
    'event_type', 'unpaid_order_cancel'
  );
end;
$$;

comment on function public.fnb_cancel_unpaid_order_atomic is
  'Atomic secure FnB unpaid-order cancel: permission check, cancel metadata, table release, and POS exception event.';

grant execute on function public.user_has_permission(uuid, text) to authenticated;
grant execute on function public.fnb_cancel_unpaid_order_atomic(uuid, text, text, uuid) to authenticated;
