-- ============================================================
-- 00077: Web Push subscriptions + 4 trigger events (CEO 16/05/2026 Day 11)
--
-- Mục đích: Lưu subscription Web Push API của từng user/device → backend
-- gửi push khi 4 sự kiện xảy ra:
--   1. OTP cấp cho cashier → push cashier biết mã 6 số
--   2. Drift kho phát hiện (cron daily) → push admin
--   3. Đơn lớn (> ngưỡng theo tenant) → push owner/admin
--   4. Tổng kết cuối ngày 23h59 → push owner
--
-- Hạ tầng:
--   - Table push_subscriptions: (user_id, endpoint, p256dh, auth)
--   - VAPID keys cấu hình ENV (NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY)
--   - API /api/push/subscribe + /api/push/unsubscribe (Day 11)
--   - Service sendPushNotification(userId, payload) gọi web-push library
-- ============================================================

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions (user_id, enabled);

create index if not exists idx_push_subscriptions_tenant
  on public.push_subscriptions (tenant_id, enabled);

comment on table public.push_subscriptions is
  'Web Push API subscription per user/device. Backend dùng để gọi web-push library gửi notification offline. CEO 16/05/2026 Day 11.';

-- ────────────────────────────────────────────────────────────────
-- Notification preferences — user opt-in cho từng loại event
-- ────────────────────────────────────────────────────────────────
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  push_otp boolean not null default true,
  push_stock_drift boolean not null default true,
  push_large_order boolean not null default true,
  push_end_of_day boolean not null default true,
  push_low_stock boolean not null default true,
  large_order_threshold numeric(15, 2) not null default 5000000,
  -- "đơn lớn" mặc định >= 5tr, owner có thể chỉnh trong /cai-dat/thong-bao
  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'User opt-in từng loại push notification + ngưỡng đơn lớn. CEO 16/05/2026 Day 11.';

-- ────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;

create policy push_subscriptions_own_select
  on public.push_subscriptions for select
  using (user_id = auth.uid());

create policy push_subscriptions_own_insert
  on public.push_subscriptions for insert
  with check (user_id = auth.uid());

create policy push_subscriptions_own_update
  on public.push_subscriptions for update
  using (user_id = auth.uid());

create policy push_subscriptions_own_delete
  on public.push_subscriptions for delete
  using (user_id = auth.uid());

create policy notif_pref_own
  on public.notification_preferences for all
  using (user_id = auth.uid());

notify pgrst, 'reload schema';
