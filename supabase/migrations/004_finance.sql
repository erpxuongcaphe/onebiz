-- OneBiz ERP - Finance module schema

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  name text not null,
  account_type text not null check (account_type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid references public.finance_accounts (id) on delete set null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists idx_finance_accounts_tenant_id on public.finance_accounts (tenant_id);
alter table public.finance_accounts enable row level security;

create policy "finance_accounts: read within tenant"
on public.finance_accounts
for select
using (tenant_id = public.current_tenant_id());

create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  transaction_number text not null,
  transaction_date date not null default current_date,
  description text,
  reference_type text,
  reference_id uuid,
  total_amount numeric(15, 2) not null,
  status text not null default 'draft' check (status in ('draft', 'posted', 'void')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, transaction_number)
);

create index if not exists idx_finance_transactions_tenant_id on public.finance_transactions (tenant_id);
create index if not exists idx_finance_transactions_date on public.finance_transactions (transaction_date desc);
alter table public.finance_transactions enable row level security;

create policy "finance_transactions: read within tenant"
on public.finance_transactions
for select
using (tenant_id = public.current_tenant_id());

create table if not exists public.finance_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  transaction_id uuid not null references public.finance_transactions (id) on delete cascade,
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  debit numeric(15, 2) not null default 0,
  credit numeric(15, 2) not null default 0,
  description text,
  created_at timestamptz not null default now(),
  constraint check_debit_or_credit check (
    (debit > 0 and credit = 0) or (credit > 0 and debit = 0)
  )
);

create index if not exists idx_finance_transaction_lines_tenant_id on public.finance_transaction_lines (tenant_id);
create index if not exists idx_finance_transaction_lines_transaction_id on public.finance_transaction_lines (transaction_id);
alter table public.finance_transaction_lines enable row level security;

create policy "finance_transaction_lines: read within tenant"
on public.finance_transaction_lines
for select
using (tenant_id = public.current_tenant_id());
