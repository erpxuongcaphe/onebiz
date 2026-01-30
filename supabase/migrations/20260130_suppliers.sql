-- ============================================
-- SUPPLIERS TABLE (Nhà cung cấp)
-- ============================================

create table if not exists public.suppliers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  
  -- Basic Info
  code varchar(50) not null,
  name varchar(255) not null,
  tax_code varchar(20), -- Mã số thuế
  
  -- Contact
  contact_person varchar(255), -- Người liên hệ
  email varchar(255),
  phone varchar(20),
  address text, -- Địa chỉ đầy đủ
  
  -- Bank Information (Thông tin tài khoản ngân hàng)
  bank_name varchar(255), -- Tên ngân hàng
  bank_account_number varchar(50), -- Số tài khoản
  bank_account_name varchar(255), -- Tên tài khoản
  bank_branch varchar(255), -- Chi nhánh
  
  -- Business Terms (Điều khoản hợp tác)
  payment_terms_days integer default 0, -- Số ngày thanh toán (0 = tiền mặt, 7/15/30/45/60/90...)
  payment_terms_description text, -- Mô tả điều khoản thanh toán (Ví dụ: "50% đặt cọc, 50% khi giao hàng")
  credit_limit decimal(15,2), -- Hạn mức công nợ tối đa
  currency varchar(3) default 'VND',
  
  -- Tax & Discount Defaults (Mặc định - có thể override trong đơn hàng)
  default_tax_percent decimal(5,2) default 10, -- Thuế VAT mặc định (8%, 10%, etc)
  default_discount_percent decimal(5,2) default 0, -- Chiết khấu mặc định
  
  -- Status & Notes
  status varchar(20) default 'active' check (status in ('active', 'inactive')),
  notes text, -- Ghi chú
  
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  
  unique(tenant_id, code)
);

-- Indexes
create index if not exists suppliers_tenant_id_idx on public.suppliers(tenant_id);
create index if not exists suppliers_status_idx on public.suppliers(status);
create index if not exists suppliers_name_idx on public.suppliers(name);

-- RLS Policies
alter table public.suppliers enable row level security;

create policy "Users can view suppliers in their tenant"
  on public.suppliers for select
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can insert suppliers in their tenant"
  on public.suppliers for insert
  with check (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can update suppliers in their tenant"
  on public.suppliers for update
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

create policy "Users can delete suppliers in their tenant"
  on public.suppliers for delete
  using (tenant_id = (select tenant_id from public.profiles where id = auth.uid()));

-- Trigger for updated_at
create or replace function update_suppliers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger suppliers_updated_at_trigger
  before update on public.suppliers
  for each row
  execute function update_suppliers_updated_at();

-- Comments
comment on table public.suppliers is 'Nhà cung cấp (B2B & B2C) - Suppliers management';
comment on column public.suppliers.payment_terms_days is 'Số ngày thanh toán (0 = tiền mặt, 7/15/30/45/60/90... hoặc tùy chỉnh)';
comment on column public.suppliers.payment_terms_description is 'Mô tả điều khoản thanh toán chi tiết, Ví dụ: "50% đặt cọc, 50% khi giao hàng"';
comment on column public.suppliers.credit_limit is 'Hạn mức công nợ tối đa cho phép';
comment on column public.suppliers.default_tax_percent is 'Thuế VAT mặc định (có thể thay đổi trong từng đơn hàng): 0%, 5%, 8%, 10%...';
comment on column public.suppliers.default_discount_percent is 'Chiết khấu mặc định (có thể thay đổi trong từng đơn hàng)';
