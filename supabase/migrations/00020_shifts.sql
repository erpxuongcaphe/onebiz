-- ============================================================
-- Shift Management (Ca làm việc)
-- Open/close shifts, cash reconciliation
-- ============================================================

create table public.shifts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  cashier_id uuid not null references public.profiles(id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  starting_cash numeric(15,2) not null default 0,
  expected_cash numeric(15,2),
  actual_cash numeric(15,2),
  cash_difference numeric(15,2),
  total_sales numeric(15,2) default 0,
  total_orders int default 0,
  sales_by_method jsonb default '{}',
  note text,
  created_at timestamptz not null default now()
);

-- Only one open shift per branch per cashier
create unique index idx_shifts_open
  on public.shifts(branch_id, cashier_id)
  where status = 'open';

create index idx_shifts_branch on public.shifts(branch_id, opened_at desc);
create index idx_shifts_cashier on public.shifts(cashier_id, opened_at desc);

-- Add shift_id to invoices for reporting
alter table public.invoices add column if not exists
  shift_id uuid references public.shifts(id) on delete set null;

-- RLS
alter table public.shifts enable row level security;

create policy "shifts_select" on public.shifts
  for select using (tenant_id = get_user_tenant_id());

create policy "shifts_insert" on public.shifts
  for insert with check (tenant_id = get_user_tenant_id());

create policy "shifts_update" on public.shifts
  for update using (tenant_id = get_user_tenant_id());
