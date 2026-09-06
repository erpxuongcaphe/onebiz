-- Minimal contract schema, NOT a full Supabase migration or RLS acceptance test.
do $$ begin
  if current_database() <> 'onebiz_fnb_test' or current_user <> 'fnb_test' then
    raise exception 'Wrong test database';
  end if;
  if to_regclass('public.products') is not null then
    raise exception 'Test requires a fresh empty database';
  end if;
end $$;
create schema extensions;
create table products(id uuid primary key, tenant_id uuid, code text, name text, bom_code text, stock numeric default 0);
create table product_variants(id uuid primary key, product_id uuid, tenant_id uuid, bom_code text);
create table bom(id uuid primary key, tenant_id uuid, product_id uuid, branch_id uuid, code text, name text, version integer default 1, is_active boolean default true);
create table bom_items(id uuid primary key default gen_random_uuid(), bom_id uuid, material_id uuid, unit text, quantity numeric, waste_percent numeric default 0, modifier_scale_target uuid, sort_order integer default 0);
create table modifier_options(id uuid primary key, group_id uuid);
create table bom_modifier_option_quantities(bom_id uuid, material_id uuid, modifier_option_id uuid, quantity numeric);
create table branch_stock(tenant_id uuid, branch_id uuid, product_id uuid, variant_id uuid, quantity numeric, reserved numeric default 0, updated_at timestamptz default now());
create unique index base_stock_unique on branch_stock(tenant_id,branch_id,product_id) where variant_id is null;
create table stock_movements(tenant_id uuid, branch_id uuid, product_id uuid, type text, quantity numeric, reference_type text, reference_id uuid, note text, created_by uuid);
create table product_lots(id uuid primary key default gen_random_uuid(),tenant_id uuid,product_id uuid,branch_id uuid,lot_number text,current_qty numeric,expiry_date date,manufactured_date date,received_date date default current_date,created_at timestamptz default now(),updated_at timestamptz,status text default 'active');
create table lot_allocations(tenant_id uuid,lot_id uuid,source_type text,source_id uuid,quantity numeric,allocated_by uuid);
-- Settings adapter fixes negative-stock policy to false for this focused suite.
create function get_tenant_setting(uuid,text,jsonb) returns jsonb language sql as $$ select 'false'::jsonb $$;
create function test_assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end $$;
