do $$ begin
  if current_database() <> 'onebiz_fnb_test' or current_user <> 'fnb_test' then
    raise exception 'Wrong test database';
  end if;
  if to_regclass('public.shifts') is not null then
    raise exception 'Shift test requires a fresh operations schema';
  end if;
end $$;

create schema if not exists auth;
create table public.test_actor_context(
  actor_id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  can_fnb_checkout boolean not null default false,
  can_retail_checkout boolean not null default false,
  can_reconcile_any boolean not null default false,
  can_reconcile_own_branch boolean not null default false
);
create table public.branches(
  id uuid primary key,
  tenant_id uuid not null,
  is_active boolean not null default true
);
create table public.shifts(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  cashier_id uuid not null,
  starting_cash numeric not null default 0,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expected_cash numeric,
  actual_cash numeric,
  cash_difference numeric,
  total_sales numeric not null default 0,
  total_orders integer not null default 0,
  sales_by_method jsonb not null default '{}'::jsonb,
  note text
);
create unique index idx_shifts_open on public.shifts(tenant_id, branch_id, cashier_id)
  where status = 'open';
create table public.cash_transactions(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  shift_id uuid,
  type text not null,
  amount numeric not null,
  payment_method text,
  status text,
  reference_type text,
  reference_id uuid
);
create table public.invoices(
  id uuid primary key default gen_random_uuid(),
  shift_id uuid,
  status text not null
);

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create or replace function test_set_actor(p_actor uuid) returns void
language plpgsql
as $$ begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
end $$;

create or replace function get_user_tenant_id() returns uuid
language sql stable
as $$ select tenant_id from public.test_actor_context where actor_id = auth.uid() $$;

create or replace function user_has_branch_access(p_actor uuid, p_branch uuid) returns boolean
language sql stable
as $$ select coalesce((select branch_id = p_branch from public.test_actor_context where actor_id = p_actor), false) $$;

create or replace function user_has_permission(p_actor uuid, p_permission text) returns boolean
language sql stable
as $$
  select coalesce((
    select case p_permission
      when 'pos_fnb.checkout' then can_fnb_checkout
      when 'pos_retail.checkout' then can_retail_checkout
      when 'shifts.reconcile_any' then can_reconcile_any
      when 'shifts.reconcile_own_branch' then can_reconcile_own_branch
      else false
    end
    from public.test_actor_context where actor_id = p_actor
  ), false)
$$;

create or replace function test_assert(ok boolean, label text) returns void
language plpgsql
as $$
begin
  if not coalesce(ok, false) then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end;
$$;
