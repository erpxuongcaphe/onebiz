-- Add new columns to inventory_products
alter table public.inventory_products
add column if not exists barcode text,
add column if not exists cost_price numeric default 0,
add column if not exists unit_id uuid references public.inventory_units(id) on delete set null,
add column if not exists type text default 'product'; -- 'product', 'material'

-- Add index for barcode for faster lookups
create index if not exists inventory_products_barcode_idx on public.inventory_products(barcode);
