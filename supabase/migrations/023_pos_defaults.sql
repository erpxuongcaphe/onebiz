-- OneBiz ERP - POS defaults (tenant_id + branch_id)

-- tenant_id defaults handled by set_tenant_id_from_context() trigger in 008
-- add branch_id defaults for POS tables

drop trigger if exists trg_pos_shifts_branch_id on public.pos_shifts;
create trigger trg_pos_shifts_branch_id
before insert on public.pos_shifts
for each row execute procedure public.set_branch_id_from_context();

drop trigger if exists trg_pos_orders_branch_id on public.pos_orders;
create trigger trg_pos_orders_branch_id
before insert on public.pos_orders
for each row execute procedure public.set_branch_id_from_context();
