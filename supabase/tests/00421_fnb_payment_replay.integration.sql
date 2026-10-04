-- Dedicated disposable CI database only. Tests the persisted-invoice replay
-- path, not first-payment posting, physical offline behaviour or stock costing.
\set ON_ERROR_STOP on
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid
$$;
create function public.user_has_permission(uuid, text) returns boolean language sql stable as $$
  select coalesce(current_setting('test.denied_permission', true), '') <> $2
$$;
create function public.user_has_branch_access(uuid, uuid) returns boolean language sql stable as $$
  select coalesce(current_setting('test.deny_branch', true), '') <> 'true'
$$;
create table public.profiles (id uuid primary key, tenant_id uuid, is_active boolean);
create table public.promotions (id uuid primary key);
create table public.coupons (id uuid primary key);
create table public.shifts (id uuid primary key, tenant_id uuid, branch_id uuid, cashier_id uuid, status text);
create table public.invoices (
  id uuid primary key, tenant_id uuid, code text, total numeric, paid numeric,
  debt numeric, discount_amount numeric, platform_commission numeric, deleted_at timestamptz
);
create table public.kitchen_orders (
  id uuid primary key, tenant_id uuid, branch_id uuid, invoice_id uuid,
  status text, table_id uuid, discount_amount numeric, delivery_fee numeric,
  platform_commission_percent numeric
);
\i /tmp/fnb-payment-replay-chain.sql

insert into profiles values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', true);
insert into invoices values ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', 'UAT-REPLAY', 30000, 30000, 0, 5000, 1200, null);
insert into kitchen_orders values ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000004', 'completed', null, 5000, 0, 4);
insert into kitchen_orders values ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', null, 'pending', null, 0, 0, 0);
insert into shifts values ('00000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'closed');
select set_config('test.actor', '00000000-0000-0000-0000-000000000001', false);

create function public.test_replay(p_order uuid default '00000000-0000-0000-0000-000000000005', p_shift uuid default null, p_paid numeric default 30000) returns jsonb language sql as $$
  select public.fnb_complete_payment_atomic_v3($1, null, 'UAT', 'cash', null, $3, false, 0, null, null, null, $2)
$$;
create function public.assert_error(p_sql text, p_state text, p_message text) returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  if v_state is distinct from p_state or v_message is distinct from p_message then
    raise exception 'Expected % / %, got % / %', p_state, p_message, v_state, v_message;
  end if;
end;
$$;
-- Reject any replay write to these business fixtures, not just duplicates.
create function public.reject_replay_write() returns trigger language plpgsql as $$
begin raise exception 'REPLAY_MUST_NOT_WRITE'; end;
$$;
create trigger no_invoice_write before insert or update or delete on invoices for each statement execute function reject_replay_write();
create trigger no_order_write before insert or update or delete on kitchen_orders for each statement execute function reject_replay_write();
create trigger no_shift_write before insert or update or delete on shifts for each statement execute function reject_replay_write();

do $$
declare v_result jsonb; v_expected jsonb;
begin
  v_expected := jsonb_build_object('invoice_id', '00000000-0000-0000-0000-000000000004', 'invoice_code', 'UAT-REPLAY', 'total', 30000, 'paid', 30000, 'debt', 0, 'discount_amount', 5000, 'platform_commission_amount', 1200, 'idempotent', true);
  for counter in 1..3 loop
    v_result := public.test_replay();
    if v_result is distinct from v_expected then raise exception 'Replay changed invoice: %', v_result; end if;
  end loop;
  -- A closed historical shift and changed valid tender must still return the
  -- persisted invoice, without recalculating its money or requiring a new shift.
  if public.test_replay(p_shift => '00000000-0000-0000-0000-000000000007', p_paid => 50000) is distinct from v_expected then
    raise exception 'Closed-shift replay changed invoice';
  end if;
end;
$$;
select assert_error('select test_replay(p_order => ''00000000-0000-0000-0000-000000000006'')', '42501', 'FNB_PAYMENT_OPEN_SHIFT_REQUIRED');
select assert_error('select test_replay(p_order => ''00000000-0000-0000-0000-000000000006'', p_shift => ''00000000-0000-0000-0000-000000000007'')', '42501', 'FNB_PAYMENT_SHIFT_NOT_OPEN_FOR_USER_BRANCH');
select assert_error('select test_replay(p_paid => -1)', '22023', 'FNB_PAYMENT_AMOUNT_INVALID');
select set_config('test.denied_permission', 'pos_fnb.checkout', false);
select assert_error('select test_replay()', '42501', 'FNB_CHECKOUT_DENIED');
select set_config('test.denied_permission', 'pos_fnb.view_orders', false);
select assert_error('select test_replay()', '42501', 'FNB_PAYMENT_DENIED');
select set_config('test.denied_permission', '', false);
select set_config('test.deny_branch', 'true', false);
select assert_error('select test_replay()', '42501', 'BRANCH_ACCESS_DENIED');
select set_config('test.deny_branch', '', false);
select set_config('test.actor', '', false);
select assert_error('select test_replay()', '42501', 'AUTH_REQUIRED');
select set_config('test.actor', '00000000-0000-0000-0000-000000000008', false);
select assert_error('select test_replay()', '42501', 'ACTIVE_PROFILE_REQUIRED');
insert into profiles values ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000009', true);
select assert_error('select test_replay()', 'P0001', 'KITCHEN_ORDER_NOT_FOUND');
select set_config('test.actor', '00000000-0000-0000-0000-000000000001', false);

-- Corrupt/deleted/cross-tenant links fail closed, never create a replacement.
alter table invoices disable trigger no_invoice_write;
update invoices set deleted_at = now();
alter table invoices enable trigger no_invoice_write;
select assert_error('select test_replay()', 'P0001', 'PAID_INVOICE_NOT_FOUND');
alter table invoices disable trigger no_invoice_write;
update invoices set deleted_at = null, tenant_id = '00000000-0000-0000-0000-000000000009';
alter table invoices enable trigger no_invoice_write;
select assert_error('select test_replay()', 'P0001', 'PAID_INVOICE_NOT_FOUND');
alter table invoices disable trigger no_invoice_write;
delete from invoices;
alter table invoices enable trigger no_invoice_write;
select assert_error('select test_replay()', 'P0001', 'PAID_INVOICE_NOT_FOUND');
\echo 'PASS: actual payment replay chain; four replay calls and twelve guard cases. No first-payment/stock-posting claim.'
