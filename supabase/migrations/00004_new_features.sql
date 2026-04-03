-- ============================================================
-- OneBiz ERP - Migration 00004: New Features
-- Favorites, Coupons/Promotions, Loyalty Points, Online Orders
-- ============================================================

-- ============================================================
-- 1. FAVORITES (Đánh dấu yêu thích trên danh sách)
-- ============================================================
create table public.favorites (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_type text not null, -- 'product', 'customer', 'supplier', 'invoice', 'order'
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  unique(user_id, entity_type, entity_id)
);

create index idx_favorites_user on public.favorites(user_id, entity_type);
create index idx_favorites_tenant on public.favorites(tenant_id);

-- ============================================================
-- 2. COUPONS / MÃ GIẢM GIÁ
-- ============================================================
create table public.coupons (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  type text not null check (type in ('fixed', 'percent')), -- Loại: cố định hoặc %
  value numeric not null default 0, -- Giá trị giảm
  min_order_amount numeric default 0, -- Đơn hàng tối thiểu
  max_discount_amount numeric, -- Giảm tối đa (cho loại %)
  max_uses integer, -- Số lần sử dụng tối đa (null = không giới hạn)
  used_count integer not null default 0,
  max_uses_per_customer integer default 1, -- Mỗi KH dùng tối đa
  start_date timestamptz,
  end_date timestamptz,
  is_active boolean not null default true,
  applies_to text not null default 'all' check (applies_to in ('all', 'category', 'product')),
  applies_to_ids uuid[] default '{}', -- IDs of categories/products nếu không áp dụng tất cả
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, code)
);

create index idx_coupons_tenant on public.coupons(tenant_id);
create index idx_coupons_code on public.coupons(tenant_id, code);
create index idx_coupons_active on public.coupons(tenant_id, is_active) where is_active = true;

-- Coupon usage log
create table public.coupon_usages (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  discount_amount numeric not null default 0,
  used_at timestamptz not null default now()
);

create index idx_coupon_usages_coupon on public.coupon_usages(coupon_id);
create index idx_coupon_usages_customer on public.coupon_usages(customer_id);

-- ============================================================
-- 3. PROMOTIONS / CHƯƠNG TRÌNH KHUYẾN MÃI
-- ============================================================
create table public.promotions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  description text,
  type text not null check (type in ('discount_percent', 'discount_fixed', 'buy_x_get_y', 'gift')),
  value numeric not null default 0,
  min_order_amount numeric default 0,
  buy_quantity integer, -- Cho buy_x_get_y: mua X
  get_quantity integer, -- Cho buy_x_get_y: tặng Y
  applies_to text not null default 'all' check (applies_to in ('all', 'category', 'product')),
  applies_to_ids uuid[] default '{}',
  start_date timestamptz not null,
  end_date timestamptz not null,
  is_active boolean not null default true,
  auto_apply boolean not null default false, -- Tự động áp dụng
  priority integer not null default 0, -- Ưu tiên (cao hơn = áp dụng trước)
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_promotions_tenant on public.promotions(tenant_id);
create index idx_promotions_active on public.promotions(tenant_id, is_active, start_date, end_date);

-- ============================================================
-- 4. LOYALTY POINTS / TÍCH ĐIỂM
-- ============================================================

-- Cài đặt tích điểm theo tenant
create table public.loyalty_settings (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade unique,
  is_enabled boolean not null default false,
  points_per_amount numeric not null default 1, -- Mỗi X đồng = 1 điểm
  amount_per_point numeric not null default 10000, -- X đồng
  redemption_points numeric not null default 100, -- Y điểm
  redemption_value numeric not null default 10000, -- = Z đồng giảm giá
  max_redemption_percent numeric not null default 50, -- Tối đa % giá trị đơn
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hạng thành viên
create table public.loyalty_tiers (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null, -- VD: Thành viên, Thân thiết, VIP, Kim cương
  min_points integer not null default 0,
  discount_percent numeric not null default 0, -- % ưu đãi cho hạng này
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_loyalty_tiers_tenant on public.loyalty_tiers(tenant_id, sort_order);

-- Lịch sử điểm thưởng
create table public.loyalty_transactions (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  type text not null check (type in ('earn', 'redeem', 'adjust', 'expire')),
  points integer not null, -- Dương = tích, Âm = dùng
  balance_after integer not null default 0,
  reference_type text, -- 'invoice', 'return', 'manual'
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_loyalty_tx_customer on public.loyalty_transactions(customer_id, created_at desc);
create index idx_loyalty_tx_tenant on public.loyalty_transactions(tenant_id);

-- Thêm cột loyalty_points vào bảng customers (nếu chưa có)
alter table public.customers add column if not exists loyalty_points integer not null default 0;
alter table public.customers add column if not exists loyalty_tier_id uuid references public.loyalty_tiers(id);

-- ============================================================
-- 5. ONLINE ORDERS / ĐƠN HÀNG ONLINE
-- ============================================================
create table public.online_orders (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_id uuid references public.sales_channels(id),
  channel_name text not null, -- 'facebook', 'zalo', 'website'
  external_order_id text, -- Mã đơn từ kênh bên ngoài
  code text not null, -- Mã đơn nội bộ (OL00001)
  customer_id uuid references public.customers(id),
  customer_name text not null,
  customer_phone text,
  customer_address text,
  items jsonb not null default '[]',
  subtotal numeric not null default 0,
  discount_amount numeric not null default 0,
  shipping_fee numeric not null default 0,
  total_amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'shipping', 'completed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  note text,
  -- Liên kết với hóa đơn nội bộ (nếu đã chuyển đổi)
  invoice_id uuid references public.invoices(id),
  shipping_order_id uuid references public.shipping_orders(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_online_orders_tenant on public.online_orders(tenant_id);
create index idx_online_orders_channel on public.online_orders(tenant_id, channel_name);
create index idx_online_orders_status on public.online_orders(tenant_id, status);
create index idx_online_orders_code on public.online_orders(tenant_id, code);

-- ============================================================
-- 6. CONVERSATIONS / HỘI THOẠI (Facebook, Zalo)
-- ============================================================
create table public.conversations (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_name text not null check (channel_name in ('facebook', 'zalo')),
  external_id text, -- ID cuộc hội thoại từ FB/Zalo
  customer_id uuid references public.customers(id),
  customer_name text not null,
  customer_avatar text,
  last_message text,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  status text not null default 'open' check (status in ('open', 'closed', 'archived')),
  assigned_to uuid references auth.users(id), -- Nhân viên phụ trách
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_tenant on public.conversations(tenant_id, channel_name);
create index idx_conversations_status on public.conversations(tenant_id, status, last_message_at desc);

create table public.conversation_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'shop', 'system')),
  sender_name text,
  content text not null,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'product', 'order')),
  metadata jsonb, -- Thông tin thêm (product_id, order_id, image_url)
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on public.conversation_messages(conversation_id, created_at);
