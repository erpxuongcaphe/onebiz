-- ============================================
-- PURCHASE ORDERS (Đơn đặt hàng nhà cung cấp)
-- ============================================

create table if not exists public.purchase_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  
  -- References
  order_number varchar(50) not null,
  supplier_id uuid not null references public.suppliers(id),
  warehouse_id uuid references public.inventory_warehouses(id),
  branch_id uuid references public.branches(id),
  
  -- Dates
  order_date date not null,
  expected_date date,
  
  -- Amounts (Số tiền)
  subtotal decimal(15,2) default 0, -- Tổng tiền hàng
  tax decimal(15,2) default 0, -- Tổng thuế
  discount decimal(15,2) default 0, -- Tổng chiết khấu
  total decimal(15,2) not null, -- Tổng cộng
  
  -- Status workflow (Quy trình trạng thái)
  status varchar(30) default 'draft' check (status in (
    'draft',           -- Nháp
    'sent',            -- Đã gửi Nhà cung cấp
    'confirmed',       -- Nhà cung cấp xác nhận
    'partial_received',-- Đã nhận một phần
    'received',        -- Đã nhận đủ
    'closed',          -- Đóng
    'cancelled'        -- Hủy
  )),
  
  -- Tracking (Theo dõi)
  notes text, -- Ghi chú
  created_by uuid references auth.users(id),
  
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(tenant_id, order_number)
);

-- Purchase Order Line Items (Chi tiết đơn đặt hàng)
create table if not exists public.purchase_order_items (
  id uuid primary key default uuid_generate_v4(),
  
  order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.inventory_products(id),
  
  quantity decimal(15,3) not null check (quantity > 0), -- Số lượng
  unit_price decimal(15,2) not null check (unit_price >= 0), -- Đơn giá
  
  -- Tax & Discount có thể khác nhau cho từng sản phẩm
  discount_percent decimal(5,2) default 0 check (discount_percent >= 0 and discount_percent <= 100),
  -- Ví dụ: 0%, 5%, 10%, 15%, 20%... tùy chương trình khuyến mãi
  
  tax_percent decimal(5,2) default 0 check (tax_percent >= 0 and tax_percent <= 100),
  -- Ví dụ: 0% (không chịu thuế), 5%, 8%, 10% (VAT)... tùy theo luật thuế
  
  -- Received tracking (Theo dõi hàng đã nhận)
  received_quantity decimal(15,3) default 0 check (received_quantity >= 0),
  
  notes text, -- Ghi chú
  created_at timestamptz default now(),
  
  check (received_quantity <= quantity)
);

-- Indexes
create index if not exists purchase_orders_tenant_id_idx on public.purchase_orders(tenant_id);
create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders(status);
create index if not exists purchase_orders_order_date_idx on public.purchase_orders(order_date desc);
create index if not exists purchase_order_items_order_id_idx on public.purchase_order_items(order_id);
create index if not exists purchase_order_items_product_id_idx on public.purchase_order_items(product_id);

-- RLS Policies
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

create policy "Users can view purchase orders in their tenant"
  on public.purchase_orders for select
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can insert purchase orders in their tenant"
  on public.purchase_orders for insert
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can update purchase orders in their tenant"
  on public.purchase_orders for update
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can delete purchase orders in their tenant"
  on public.purchase_orders for delete
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- PO Items inherit access from parent PO
create policy "Users can view purchase order items"
  on public.purchase_order_items for select
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.order_id
      and po.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can insert purchase order items"
  on public.purchase_order_items for insert
  with check (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.order_id
      and po.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can update purchase order items"
  on public.purchase_order_items for update
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.order_id
      and po.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

create policy "Users can delete purchase order items"
  on public.purchase_order_items for delete
  using (exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_items.order_id
      and po.tenant_id = (select tenant_id from public.profiles where id = auth.uid())
  ));

-- Trigger for updated_at
create or replace function update_purchase_orders_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger purchase_orders_updated_at_trigger
  before update on public.purchase_orders
  for each row
  execute function update_purchase_orders_updated_at();

-- Auto-generate PO number
create or replace function generate_purchase_order_number(p_tenant_id uuid)
returns varchar as $$
declare
  v_seq integer;
  v_number varchar;
begin
  -- Format: PO-YYYYMMDD-0001
  select coalesce(max(
    cast(substring(order_number from '[0-9]+$') as integer)
  ), 0) + 1
  into v_seq
  from public.purchase_orders
  where tenant_id = p_tenant_id
    and order_number like 'PO-' || to_char(now(), 'YYYYMMDD') || '-%';
  
  v_number := 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');
  return v_number;
end;
$$ language plpgsql;

-- Comments
comment on table public.purchase_orders is 'Đơn đặt hàng nhà cung cấp - Purchase orders from suppliers';
comment on table public.purchase_order_items is 'Chi tiết đơn đặt hàng - Purchase order line items';
comment on column public.purchase_orders.status is 'Trạng thái: draft (nháp) → sent (đã gửi) → confirmed (Nhà cung cấp xác nhận) → partial_received (nhận một phần) → received (nhận đủ) → closed (đóng) / cancelled (hủy)';
comment on column public.purchase_order_items.received_quantity is 'Tổng số lượng đã nhận qua các phiếu nhập kho';
comment on column public.purchase_order_items.tax_percent is 'Thuế VAT (%): 0%, 5%, 8%, 10%... tùy theo quy định pháp luật';
comment on column public.purchase_order_items.discount_percent is 'Chiết khấu (%): tùy theo chương trình khuyến mãi hoặc chính sách của công ty';
