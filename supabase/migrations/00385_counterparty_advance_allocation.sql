-- 00385: Controlled allocation of customer deposits and supplier advances.
--
-- Money is recorded only when received/paid. Applying a balance to an invoice
-- or purchase order is a ledger allocation, never a second cash transaction.

begin;

create table if not exists public.customer_advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  cash_transaction_id uuid not null unique references public.cash_transactions(id) on delete restrict,
  adjustment_id uuid unique references public.customer_debt_adjustments(id) on delete restrict,
  original_amount numeric(15,2) not null check (original_amount > 0),
  remaining_amount numeric(15,2) not null check (remaining_amount >= 0 and remaining_amount <= original_amount),
  status text not null default 'active' check (status in ('active', 'exhausted', 'cancelled')),
  note text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_advances_available
  on public.customer_advances(tenant_id, branch_id, customer_id, created_at)
  where status = 'active' and remaining_amount > 0;

create table if not exists public.supplier_advance_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  supplier_advance_id uuid not null references public.supplier_advances(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  amount numeric(15,2) not null check (amount > 0),
  note text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_supplier_advance_allocations_order
  on public.supplier_advance_allocations(tenant_id, purchase_order_id);

create table if not exists public.customer_advance_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  customer_advance_id uuid not null references public.customer_advances(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  adjustment_id uuid not null unique references public.customer_debt_adjustments(id) on delete restrict,
  amount numeric(15,2) not null check (amount > 0),
  note text not null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_advance_allocations_invoice
  on public.customer_advance_allocations(tenant_id, invoice_id);

alter table public.customer_advances enable row level security;
alter table public.supplier_advance_allocations enable row level security;
alter table public.customer_advance_allocations enable row level security;

drop policy if exists customer_advances_select on public.customer_advances;
create policy customer_advances_select on public.customer_advances for select using (
  tenant_id = public.get_user_tenant_id()
  and public.user_has_branch_access(auth.uid(), branch_id)
  and public.user_has_permission(auth.uid(), 'customers.view_debt')
);
drop policy if exists supplier_advance_allocations_select on public.supplier_advance_allocations;
create policy supplier_advance_allocations_select on public.supplier_advance_allocations for select using (
  tenant_id = public.get_user_tenant_id()
  and public.user_has_branch_access(auth.uid(), branch_id)
  and public.user_has_permission(auth.uid(), 'suppliers.view_debt')
);
drop policy if exists customer_advance_allocations_select on public.customer_advance_allocations;
create policy customer_advance_allocations_select on public.customer_advance_allocations for select using (
  tenant_id = public.get_user_tenant_id()
  and public.user_has_branch_access(auth.uid(), branch_id)
  and public.user_has_permission(auth.uid(), 'customers.view_debt')
);
revoke insert, update, delete on public.customer_advances, public.supplier_advance_allocations, public.customer_advance_allocations from public, anon, authenticated;
grant select on public.customer_advances, public.supplier_advance_allocations, public.customer_advance_allocations to authenticated;

-- Preserve advances recorded by 00384 before this ledger existed.
insert into public.customer_advances (
  tenant_id, branch_id, customer_id, cash_transaction_id, adjustment_id,
  original_amount, remaining_amount, note, created_by, created_at
)
select a.tenant_id, a.branch_id, a.customer_id, a.cash_transaction_id, a.id,
  -a.amount, -a.amount, a.reason, a.created_by, a.created_at
from public.customer_debt_adjustments a
join public.cash_transactions ct on ct.id = a.cash_transaction_id
where a.amount < 0
  and a.cash_transaction_id is not null
  and ct.category = 'customer_advance'
  and ct.status = 'completed'
  and a.branch_id is not null
on conflict (cash_transaction_id) do nothing;

create or replace function public.record_customer_advance(
  p_customer_id uuid, p_amount numeric, p_payment_method text, p_note text,
  p_branch_id uuid, p_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_tenant_id uuid; v_customer record; v_amount numeric(15,2);
  v_note text := nullif(trim(coalesce(p_note, '')), ''); v_cash_id uuid; v_cash_code text;
  v_adjustment_id uuid; v_advance_id uuid;
begin
  v_actor := case when coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then p_user_id else auth.uid() end;
  if v_actor is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select p.tenant_id into v_tenant_id from public.profiles p where p.id = v_actor and coalesce(p.is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION'; end if;
  if p_branch_id is null or not public.user_has_branch_access(v_actor, p_branch_id) then raise exception using errcode = '42501', message = 'ADVANCE_BRANCH_REQUIRED_OR_DENIED'; end if;
  select c.id, c.name into v_customer from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant_id for update;
  if not found then raise exception using errcode = '22023', message = 'CUSTOMER_NOT_FOUND'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 9999999999999.99 then raise exception using errcode = '22023', message = 'INVALID_ADVANCE_AMOUNT'; end if;
  if p_payment_method not in ('cash', 'transfer', 'card', 'ewallet') then raise exception using errcode = '22023', message = 'INVALID_PAYMENT_METHOD'; end if;
  if v_note is null or length(v_note) < 3 then raise exception using errcode = '22023', message = 'CUSTOMER_ADVANCE_NOTE_REQUIRED'; end if;
  v_amount := round(p_amount, 2); v_cash_code := public.next_cash_code(v_tenant_id, 'receipt');
  insert into public.cash_transactions (tenant_id, branch_id, code, type, category, amount, counterparty, payment_method, customer_id, note, created_by, status, transaction_date)
  values (v_tenant_id, p_branch_id, v_cash_code, 'receipt', 'customer_advance', v_amount, v_customer.name, p_payment_method, p_customer_id, v_note, v_actor, 'completed', current_date)
  returning id into v_cash_id;
  insert into public.customer_debt_adjustments (tenant_id, branch_id, customer_id, amount, reason, idempotency_key, cash_transaction_id, created_by)
  values (v_tenant_id, p_branch_id, p_customer_id, -v_amount, v_note, 'customer-advance:' || v_cash_id::text, v_cash_id, v_actor)
  returning id into v_adjustment_id;
  insert into public.customer_advances (tenant_id, branch_id, customer_id, cash_transaction_id, adjustment_id, original_amount, remaining_amount, note, created_by)
  values (v_tenant_id, p_branch_id, p_customer_id, v_cash_id, v_adjustment_id, v_amount, v_amount, v_note, v_actor) returning id into v_advance_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_tenant_id, v_actor, 'customer_advance_recorded', 'cash_transaction', v_cash_id, jsonb_build_object('customer_id', p_customer_id, 'branch_id', p_branch_id, 'amount', v_amount, 'cash_code', v_cash_code, 'customer_advance_id', v_advance_id));
  return jsonb_build_object('cash_transaction_id', v_cash_id, 'cash_code', v_cash_code, 'advance_amount', v_amount, 'advance_id', v_advance_id);
end; $$;

create or replace function public.apply_supplier_advance_to_purchase_order(
  p_purchase_order_id uuid, p_amount numeric default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_tenant_id uuid; v_po record; v_requested numeric(15,2);
  v_available numeric(15,2); v_remaining numeric(15,2); v_take numeric(15,2); v_applied numeric(15,2) := 0;
  v_advance record; v_allocation_id uuid; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_items jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select tenant_id into v_tenant_id from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION'; end if;
  select po.id, po.tenant_id, po.branch_id, po.code, po.supplier_id, po.debt, po.paid, po.total, po.status into v_po from public.purchase_orders po where po.id = p_purchase_order_id and po.tenant_id = v_tenant_id for update;
  if not found then raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_FOUND'; end if;
  if v_po.supplier_id is null or v_po.status not in ('completed', 'partial') or coalesce(v_po.debt, 0) <= 0 then raise exception using errcode = '22023', message = 'PURCHASE_ORDER_NOT_APPLICABLE'; end if;
  if not public.user_has_branch_access(v_actor, v_po.branch_id) then raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED'; end if;
  if v_note is null or length(v_note) < 3 then raise exception using errcode = '22023', message = 'ADVANCE_ALLOCATION_NOTE_REQUIRED'; end if;
  select coalesce(sum(remaining_amount), 0) into v_available from public.supplier_advances where tenant_id = v_tenant_id and branch_id = v_po.branch_id and supplier_id = v_po.supplier_id and status = 'active' and remaining_amount > 0;
  v_requested := round(coalesce(p_amount, least(v_po.debt, v_available)), 2);
  if v_requested <= 0 or v_requested > v_po.debt or v_requested > v_available then raise exception using errcode = '22023', message = 'SUPPLIER_ADVANCE_ALLOCATION_AMOUNT_INVALID'; end if;
  v_remaining := v_requested;
  for v_advance in select * from public.supplier_advances where tenant_id = v_tenant_id and branch_id = v_po.branch_id and supplier_id = v_po.supplier_id and status = 'active' and remaining_amount > 0 order by created_at, id for update loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_advance.remaining_amount);
    insert into public.supplier_advance_allocations (tenant_id, branch_id, supplier_advance_id, purchase_order_id, amount, note, created_by) values (v_tenant_id, v_po.branch_id, v_advance.id, v_po.id, v_take, v_note, v_actor) returning id into v_allocation_id;
    update public.supplier_advances set remaining_amount = remaining_amount - v_take, status = case when remaining_amount - v_take <= 0 then 'exhausted' else 'active' end, updated_at = now() where id = v_advance.id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('advance_id', v_advance.id, 'allocation_id', v_allocation_id, 'amount', v_take));
    v_remaining := v_remaining - v_take; v_applied := v_applied + v_take;
  end loop;
  if v_remaining <> 0 then raise exception using errcode = 'P0001', message = 'SUPPLIER_ADVANCE_ALLOCATION_INCOMPLETE'; end if;
  update public.purchase_orders set paid = round(coalesce(paid, 0) + v_applied, 2), debt = greatest(0, round(coalesce(debt, 0) - v_applied, 2)), updated_at = now() where id = v_po.id and tenant_id = v_tenant_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data) values (v_tenant_id, v_actor, 'supplier_advance_applied', 'purchase_order', v_po.id, jsonb_build_object('amount', v_applied, 'note', v_note, 'allocations', v_items));
  return jsonb_build_object('purchase_order_id', v_po.id, 'purchase_order_code', v_po.code, 'applied_amount', v_applied, 'remaining_debt', greatest(0, round(v_po.debt - v_applied, 2)), 'allocations', v_items);
end; $$;

create or replace function public.apply_customer_advance_to_invoice(
  p_invoice_id uuid, p_amount numeric default null, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_tenant_id uuid; v_invoice record; v_requested numeric(15,2); v_available numeric(15,2); v_remaining numeric(15,2); v_take numeric(15,2); v_applied numeric(15,2) := 0;
  v_advance record; v_adjustment_id uuid; v_allocation_id uuid; v_note text := nullif(trim(coalesce(p_note, '')), ''); v_items jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'UNAUTHENTICATED'; end if;
  select tenant_id into v_tenant_id from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'ACTIVE_PROFILE_REQUIRED'; end if;
  if not public.user_has_permission(v_actor, 'finance.create_transaction') then raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION'; end if;
  select i.id, i.tenant_id, i.branch_id, i.code, i.customer_id, i.debt, i.paid, i.total, i.status into v_invoice from public.invoices i where i.id = p_invoice_id and i.tenant_id = v_tenant_id for update;
  if not found then raise exception using errcode = '22023', message = 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.customer_id is null or v_invoice.status <> 'completed' or coalesce(v_invoice.debt, 0) <= 0 then raise exception using errcode = '22023', message = 'INVOICE_NOT_APPLICABLE'; end if;
  if not public.user_has_branch_access(v_actor, v_invoice.branch_id) then raise exception using errcode = '42501', message = 'BRANCH_ACCESS_DENIED'; end if;
  if v_note is null or length(v_note) < 3 then raise exception using errcode = '22023', message = 'ADVANCE_ALLOCATION_NOTE_REQUIRED'; end if;
  select coalesce(sum(remaining_amount), 0) into v_available from public.customer_advances where tenant_id = v_tenant_id and branch_id = v_invoice.branch_id and customer_id = v_invoice.customer_id and status = 'active' and remaining_amount > 0;
  v_requested := round(coalesce(p_amount, least(v_invoice.debt, v_available)), 2);
  if v_requested <= 0 or v_requested > v_invoice.debt or v_requested > v_available then raise exception using errcode = '22023', message = 'CUSTOMER_ADVANCE_ALLOCATION_AMOUNT_INVALID'; end if;
  v_remaining := v_requested;
  for v_advance in select * from public.customer_advances where tenant_id = v_tenant_id and branch_id = v_invoice.branch_id and customer_id = v_invoice.customer_id and status = 'active' and remaining_amount > 0 order by created_at, id for update loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_advance.remaining_amount);
    insert into public.customer_debt_adjustments (tenant_id, branch_id, customer_id, invoice_id, amount, reason, idempotency_key, created_by) values (v_tenant_id, v_invoice.branch_id, v_invoice.customer_id, v_invoice.id, v_take, 'Cấn tiền khách trả trước: ' || v_note, 'customer-advance-allocation:' || v_advance.id::text || ':' || v_invoice.id::text || ':' || v_take::text || ':' || gen_random_uuid()::text, v_actor) returning id into v_adjustment_id;
    insert into public.customer_advance_allocations (tenant_id, branch_id, customer_advance_id, invoice_id, adjustment_id, amount, note, created_by) values (v_tenant_id, v_invoice.branch_id, v_advance.id, v_invoice.id, v_adjustment_id, v_take, v_note, v_actor) returning id into v_allocation_id;
    update public.customer_advances set remaining_amount = remaining_amount - v_take, status = case when remaining_amount - v_take <= 0 then 'exhausted' else 'active' end, updated_at = now() where id = v_advance.id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('advance_id', v_advance.id, 'allocation_id', v_allocation_id, 'amount', v_take));
    v_remaining := v_remaining - v_take; v_applied := v_applied + v_take;
  end loop;
  if v_remaining <> 0 then raise exception using errcode = 'P0001', message = 'CUSTOMER_ADVANCE_ALLOCATION_INCOMPLETE'; end if;
  update public.invoices set paid = round(coalesce(paid, 0) + v_applied, 2), debt = greatest(0, round(coalesce(debt, 0) - v_applied, 2)), updated_at = now() where id = v_invoice.id and tenant_id = v_tenant_id;
  insert into public.audit_log (tenant_id, user_id, action, entity_type, entity_id, new_data) values (v_tenant_id, v_actor, 'customer_advance_applied', 'invoice', v_invoice.id, jsonb_build_object('amount', v_applied, 'note', v_note, 'allocations', v_items));
  return jsonb_build_object('invoice_id', v_invoice.id, 'invoice_code', v_invoice.code, 'applied_amount', v_applied, 'remaining_debt', greatest(0, round(v_invoice.debt - v_applied, 2)), 'allocations', v_items);
end; $$;

-- A cash transaction may be cancelled only while its advance is completely unused.
create or replace function public.trg_block_allocated_advance_cash_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'completed' and new.status = 'cancelled' and (
    exists (select 1 from public.supplier_advances a where a.cash_transaction_id = old.id and a.remaining_amount < a.original_amount)
    or exists (select 1 from public.customer_advances a where a.cash_transaction_id = old.id and a.remaining_amount < a.original_amount)
  ) then raise exception using errcode = '22023', message = 'ADVANCE_ALREADY_APPLIED_CANNOT_CANCEL'; end if;
  return new;
end; $$;
revoke all on function public.trg_block_allocated_advance_cash_cancel() from public, anon, authenticated;
drop trigger if exists trg_cash_cancel_block_allocated_advance on public.cash_transactions;
create trigger trg_cash_cancel_block_allocated_advance before update of status on public.cash_transactions for each row execute function public.trg_block_allocated_advance_cash_cancel();

create or replace function public.trg_reverse_direct_advance_on_cash_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_customer_advance record;
begin
  if old.status = 'completed' and new.status = 'cancelled' then
    update public.supplier_advances set remaining_amount = 0, status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where cash_transaction_id = new.id and status = 'active' and remaining_amount = original_amount;
    select * into v_customer_advance from public.customer_advances where cash_transaction_id = new.id and status = 'active' and remaining_amount = original_amount for update;
    if found then
      update public.customer_advances set remaining_amount = 0, status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now(), updated_at = now() where id = v_customer_advance.id;
      insert into public.customer_debt_adjustments (tenant_id, branch_id, customer_id, amount, reason, idempotency_key, created_by)
      values (v_customer_advance.tenant_id, v_customer_advance.branch_id, v_customer_advance.customer_id, v_customer_advance.original_amount, 'Đảo tiền khách trả trước do hủy ' || new.code, 'cancel-customer-advance:' || new.id::text, auth.uid()) on conflict (tenant_id, idempotency_key) do nothing;
    end if;
  end if;
  return new;
end; $$;

-- Only genuine remaining deposits are shown as “Khách trả trước”; applied
-- deposits no longer inflate either the customer debt or the advance column.
create or replace function public.get_counterparty_balance_summary(p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_tenant_id uuid;
begin
  perform public.assert_report_access('reports.analytics', p_branch_id); perform public.assert_report_access('reports.view_detail', p_branch_id);
  select tenant_id into v_tenant_id from public.profiles where id = v_actor and coalesce(is_active, true);
  if v_tenant_id is null then raise exception using errcode = '42501', message = 'REPORT_PROFILE_INACTIVE'; end if;
  return jsonb_build_object(
    'customers', (with invoice_debt as (select customer_id, sum(greatest(coalesce(debt,0),0)) amount from public.invoices where tenant_id=v_tenant_id and status='completed' and deleted_at is null and customer_id is not null and (p_branch_id is null or branch_id=p_branch_id) group by customer_id), adjustments as (select a.customer_id, sum(greatest(a.amount,0)) debit, sum(greatest(-a.amount,0)) credit from public.customer_debt_adjustments a left join public.cash_transactions ct on ct.id=a.cash_transaction_id where a.tenant_id=v_tenant_id and (p_branch_id is null or a.branch_id=p_branch_id) and coalesce(ct.category,'') <> 'customer_advance' and a.idempotency_key not like 'customer-advance-allocation:%' group by a.customer_id), advances as (select customer_id,sum(remaining_amount) amount from public.customer_advances where tenant_id=v_tenant_id and status='active' and remaining_amount>0 and (p_branch_id is null or branch_id=p_branch_id) group by customer_id), opening as (select customer_id,sum(greatest(amount,0)) debit,sum(greatest(-amount,0)) credit from public.debt_opening_balances where tenant_id=v_tenant_id and party_type='customer' and (p_branch_id is null or branch_id=p_branch_id) group by customer_id) select coalesce(jsonb_agg(jsonb_build_object('party_id',c.id,'debt',round(coalesce(i.amount,0)+coalesce(a.debit,0)+coalesce(o.debit,0),2),'advance',round(coalesce(x.amount,0)+coalesce(a.credit,0)+coalesce(o.credit,0),2)) order by c.name),'[]'::jsonb) from public.customers c left join invoice_debt i on i.customer_id=c.id left join adjustments a on a.customer_id=c.id left join advances x on x.customer_id=c.id left join opening o on o.customer_id=c.id where c.tenant_id=v_tenant_id and (coalesce(i.amount,0)+coalesce(a.debit,0)+coalesce(o.debit,0)+coalesce(x.amount,0)+coalesce(a.credit,0)+coalesce(o.credit,0))>0.01),
    'suppliers', (with purchase_debt as (select supplier_id,sum(greatest(coalesce(debt,0),0)) amount from public.purchase_orders where tenant_id=v_tenant_id and status in ('completed','partial') and supplier_id is not null and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id), advances as (select supplier_id,sum(remaining_amount) amount from public.supplier_advances where tenant_id=v_tenant_id and status='active' and remaining_amount>0 and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id), opening as (select supplier_id,sum(greatest(amount,0)) debit,sum(greatest(-amount,0)) credit from public.debt_opening_balances where tenant_id=v_tenant_id and party_type='supplier' and (p_branch_id is null or branch_id=p_branch_id) group by supplier_id) select coalesce(jsonb_agg(jsonb_build_object('party_id',s.id,'debt',round(coalesce(p.amount,0)+coalesce(o.debit,0),2),'advance',round(coalesce(a.amount,0)+coalesce(o.credit,0),2)) order by s.name),'[]'::jsonb) from public.suppliers s left join purchase_debt p on p.supplier_id=s.id left join advances a on a.supplier_id=s.id left join opening o on o.supplier_id=s.id where s.tenant_id=v_tenant_id and (coalesce(p.amount,0)+coalesce(o.debit,0)+coalesce(a.amount,0)+coalesce(o.credit,0))>0.01)
  );
end; $$;

revoke all on function public.apply_supplier_advance_to_purchase_order(uuid,numeric,text) from public, anon;
revoke all on function public.apply_customer_advance_to_invoice(uuid,numeric,text) from public, anon;
grant execute on function public.apply_supplier_advance_to_purchase_order(uuid,numeric,text) to authenticated;
grant execute on function public.apply_customer_advance_to_invoice(uuid,numeric,text) to authenticated;

commit;

-- Read-only postflight. All values must be true before using the UI.
select
  to_regclass('public.customer_advances') is not null as customer_advance_ledger_ok,
  to_regclass('public.supplier_advance_allocations') is not null as supplier_allocation_ledger_ok,
  to_regclass('public.customer_advance_allocations') is not null as customer_allocation_ledger_ok,
  to_regprocedure('public.apply_supplier_advance_to_purchase_order(uuid,numeric,text)') is not null as supplier_apply_rpc_ok,
  to_regprocedure('public.apply_customer_advance_to_invoice(uuid,numeric,text)') is not null as customer_apply_rpc_ok,
  to_regprocedure('public.trg_block_allocated_advance_cash_cancel()') is not null as cancellation_guard_ok;
