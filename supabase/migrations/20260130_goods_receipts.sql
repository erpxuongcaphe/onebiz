-- ============================================
-- GOODS RECEIPTS (Phiếu nhập kho)
-- ============================================

create table if not exists public.goods_receipts (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  
  document_number varchar(50) not null,
  document_date date not null,
  
  -- References
  purchase_order_id uuid references public.purchase_orders(id),
  supplier_id uuid not null references public.suppliers(id),
  warehouse_id uuid not null references public.inventory_warehouses(id),
  
  -- Status
  status varchar(20) default 'draft' check (status in ('draft', 'completed', 'void')),
  
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(tenant_id, document_number)
);

-- Goods Receipt Line Items
create table if not exists public.goods_receipt_items (
  id uuid primary key default uuid_generate_v4(),
  
  receipt_id uuid not null references public.goods_receipts(id) on delete cascade,
  product_id uuid not null references public.inventory_products(id),
  purchase_order_item_id uuid references public.purchase_order_items(id),
  
  quantity decimal(15,3) not null check (quantity > 0),
  unit_price decimal(15,2),
  
  -- Lot tracking (optional)
  lot_number varchar(50),
  expiry_date date,
  
  created_at timestamptz default now()
);

-- Indexes
create index if not exists goods_receipts_tenant_id_idx on public.goods_receipts(tenant_id);
create index if not exists goods_receipts_supplier_id_idx on public.goods_receipts(supplier_id);
create index if not exists goods_receipts_warehouse_id_idx on public.goods_receipts(warehouse_id);
create index if not exists goods_receipts_po_id_idx on public.goods_receipts(purchase_order_id);
create index if not exists goods_receipts_status_idx on public.goods_receipts(status);
create index if not exists goods_receipts_date_idx on public.goods_receipts(document_date desc);
create index if not exists goods_receipt_items_receipt_id_idx on public.goods_receipt_items(receipt_id);
create index if not exists goods_receipt_items_product_id_idx on public.goods_receipt_items(product_id);

-- RLS Policies
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;

create policy "Users can view goods receipts in their tenant"
  on public.goods_receipts for select
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can insert goods receipts in their tenant"
  on public.goods_receipts for insert
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can update goods receipts in their tenant"
  on public.goods_receipts for update
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can delete goods receipts in their tenant"
  on public.goods_receipts for delete
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- GR Items inherit access from parent GR
create policy "Users can view goods receipt items"
  on public.goods_receipt_items for select
  using (exists (
    select 1 from public.goods_receipts gr
    where gr.id = goods_receipt_items.receipt_id
      and gr.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can insert goods receipt items"
  on public.goods_receipt_items for insert
  with check (exists (
    select 1 from public.goods_receipts gr
    where gr.id = goods_receipt_items.receipt_id
      and gr.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can update goods receipt items"
  on public.goods_receipt_items for update
  using (exists (
    select 1 from public.goods_receipts gr
    where gr.id = goods_receipt_items.receipt_id
      and gr.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can delete goods receipt items"
  on public.goods_receipt_items for delete
  using (exists (
    select 1 from public.goods_receipts gr
    where gr.id = goods_receipt_items.receipt_id
      and gr.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

-- Trigger for updated_at
create or replace function update_goods_receipts_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger goods_receipts_updated_at_trigger
  before update on public.goods_receipts
  for each row
  execute function update_goods_receipts_updated_at();

-- Auto-generate GR number
create or replace function generate_goods_receipt_number(p_tenant_id uuid)
returns varchar as $$
declare
  v_seq integer;
  v_number varchar;
begin
  -- Format: GR-YYYYMMDD-0001
  select coalesce(max(
    cast(substring(document_number from '[0-9]+$') as integer)
  ), 0) + 1
  into v_seq
  from public.goods_receipts
  where tenant_id = p_tenant_id
    and document_number like 'GR-' || to_char(now(), 'YYYYMMDD') || '-%';
  
  v_number := 'GR-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
  return v_number;
end;
$$ language plpgsql;

-- Complete Goods Receipt → Update Stock & PO
create or replace function complete_goods_receipt(p_receipt_id uuid)
returns void as $$
declare
  v_tenant_id uuid;
  v_warehouse_id uuid;
  v_po_id uuid;
  v_created_by uuid;
  v_doc_number varchar;
begin
  -- Get receipt info
  select tenant_id, warehouse_id, purchase_order_id, created_by, document_number
  into v_tenant_id, v_warehouse_id, v_po_id, v_created_by, v_doc_number
  from public.goods_receipts
  where id = p_receipt_id;
  
  -- 1. Insert stock movements (using existing function)
  insert into public.inventory_stock_movements (
    tenant_id, product_id, warehouse_id, movement_type, quantity, 
    reference_type, reference_id, notes, created_by
  )
  select 
    v_tenant_id, 
    gri.product_id, 
    v_warehouse_id, 
    'purchase', 
    gri.quantity,
    'goods_receipt', 
    p_receipt_id, 
    'GR: ' || v_doc_number, 
    v_created_by
  from public.goods_receipt_items gri
  where gri.receipt_id = p_receipt_id;
  
  -- 2. Update inventory_stock (upsert)
  insert into public.inventory_stock (tenant_id, product_id, warehouse_id, quantity)
  select 
    v_tenant_id,
    gri.product_id,
    v_warehouse_id,
    gri.quantity
  from public.goods_receipt_items gri
  where gri.receipt_id = p_receipt_id
  on conflict (tenant_id, product_id, warehouse_id)
  do update set quantity = inventory_stock.quantity + excluded.quantity;
  
  -- 3. Update PO received quantities (if linked to PO)
  if v_po_id is not null then
    update public.purchase_order_items poi
    set received_quantity = received_quantity + gri.quantity
    from public.goods_receipt_items gri
    where gri.purchase_order_item_id = poi.id
      and gri.receipt_id = p_receipt_id;
    
    -- 4. Update PO status based on fulfillment
    update public.purchase_orders
    set status = case
      when (
        select sum(quantity) 
        from public.purchase_order_items 
        where order_id = v_po_id
      ) = (
        select sum(received_quantity) 
        from public.purchase_order_items 
        where order_id = v_po_id
      ) then 'received'
      else 'partial_received'
    end
    where id = v_po_id and status not in ('closed', 'cancelled');
  end if;
  
  -- 5. Mark receipt as completed
  update public.goods_receipts 
  set status = 'completed', updated_at = now() 
  where id = p_receipt_id;
end;
$$ language plpgsql security definer;

-- Comments
comment on table public.goods_receipts is 'Phiếu nhập kho - Goods receipt notes';
comment on table public.goods_receipt_items is 'Chi tiết phiếu nhập - Goods receipt line items';
comment on function complete_goods_receipt is 'Complete GR: update stock, PO quantities, and status';
