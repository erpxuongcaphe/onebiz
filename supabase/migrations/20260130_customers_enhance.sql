-- ============================================
-- ENHANCE SALES_CUSTOMERS TABLE
-- ============================================

-- Add new columns for B2B and B2C functionality
alter table public.sales_customers
  add column if not exists code varchar(50), -- Mã khách hàng
  add column if not exists tax_code varchar(20), -- Mã số thuế (cho doanh nghiệp)
  add column if not exists id_card_number varchar(20), -- Số Căn cước công dân / Chứng minh nhân dân (cho cá nhân)
  add column if not exists customer_type varchar(20) default 'retail' 
    check (customer_type in ('retail', 'wholesale', 'vip', 'corporate', 'individual')),
  -- retail: bán lẻ, wholesale: bán sỉ, vip: khách VIP, corporate: doanh nghiệp, individual: cá nhân
  
  -- Payment Terms (Điều khoản thanh toán)
  add column if not exists payment_terms_days integer default 0, -- Số ngày thanh toán (0 = Thanh toán khi nhận hàng)
  add column if not exists payment_terms_description text, -- Mô tả chi tiết
  add column if not exists credit_limit decimal(15,2), -- Hạn mức công nợ
  
  -- Additional Contact
  add column if not exists contact_person varchar(255), -- Người liên hệ
  
  -- Bank Information (Thông tin ngân hàng - cho khách thanh toán chuyển khoản)
  add column if not exists bank_name varchar(255),
  add column if not exists bank_account_number varchar(50),
  add column if not exists bank_account_name varchar(255),
  
  -- Status
  add column if not exists status varchar(20) default 'active'
    check (status in ('active', 'inactive', 'suspended'));


-- Add unique constraint for code
create unique index if not exists sales_customers_code_unique 
  on public.sales_customers(tenant_id, code) 
  where code is not null;

-- Add indexes for better query performance
create index if not exists sales_customers_type_idx on public.sales_customers(customer_type);
create index if not exists sales_customers_status_idx on public.sales_customers(status);

-- Comments
comment on column public.sales_customers.code is 'Mã khách hàng (unique trong tenant)';
comment on column public.sales_customers.customer_type is 'Loại khách: retail (lẻ), wholesale (sỉ), vip (VIP), corporate (doanh nghiệp), individual (cá nhân)';
comment on column public.sales_customers.tax_code is 'Mã số thuế (cho doanh nghiệp)';
comment on column public.sales_customers.id_card_number is 'Số Căn cước công dân / Chứng minh nhân dân (cho cá nhân)';
comment on column public.sales_customers.payment_terms_days is 'Số ngày thanh toán (0 = Thanh toán khi nhận hàng / tiền mặt, 7/15/30... tùy chỉnh)';
comment on column public.sales_customers.payment_terms_description is 'Mô tả điều khoản thanh toán chi tiết';
comment on column public.sales_customers.credit_limit is 'Hạn mức công nợ tối đa cho phép';
comment on column public.sales_customers.bank_account_number is 'Số tài khoản ngân hàng (nếu khách thanh toán chuyển khoản)';
