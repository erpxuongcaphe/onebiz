-- OneBiz ERP - Tenant defaults for new module tables

-- POS tables
drop trigger if exists trg_pos_shifts_tenant_id on public.pos_shifts;
create trigger trg_pos_shifts_tenant_id
before insert on public.pos_shifts
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_pos_orders_tenant_id on public.pos_orders;
create trigger trg_pos_orders_tenant_id
before insert on public.pos_orders
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_pos_order_items_tenant_id on public.pos_order_items;
create trigger trg_pos_order_items_tenant_id
before insert on public.pos_order_items
for each row execute procedure public.set_tenant_id_from_context();

drop trigger if exists trg_pos_payments_tenant_id on public.pos_payments;
create trigger trg_pos_payments_tenant_id
before insert on public.pos_payments
for each row execute procedure public.set_tenant_id_from_context();

-- Inventory documents
drop trigger if exists trg_inventory_documents_tenant_id on public.inventory_documents;
create trigger trg_inventory_documents_tenant_id
before insert on public.inventory_documents
for each row execute procedure public.set_tenant_id_from_context();
