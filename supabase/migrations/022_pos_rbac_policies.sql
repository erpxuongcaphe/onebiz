-- OneBiz ERP - POS policies using RBAC + branch scope

-- Helper rule: allow cross-branch if branch.read_all
-- Else restrict to current branch.

-- Shifts
create policy "pos_shifts: read"
on public.pos_shifts
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "pos_shifts: insert"
on public.pos_shifts
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.open')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "pos_shifts: update"
on public.pos_shifts
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.update')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.shift.update')
);

-- Orders
create policy "pos_orders: read"
on public.pos_orders
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "pos_orders: insert"
on public.pos_orders
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.create')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
);

create policy "pos_orders: update"
on public.pos_orders
for update
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
  and (
    public.has_permission('branch.read_all')
    or branch_id = public.current_branch_id()
  )
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

-- Order items
create policy "pos_order_items: read"
on public.pos_order_items
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
);

create policy "pos_order_items: insert"
on public.pos_order_items
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.order.update')
);

-- Payments
create policy "pos_payments: read"
on public.pos_payments
for select
using (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.read')
);

create policy "pos_payments: insert"
on public.pos_payments
for insert
with check (
  tenant_id = public.current_tenant_id()
  and public.has_permission('pos.payment.record')
);
