-- ============================================================
-- 00068: Giá bán theo nền tảng đơn (per-product per-platform override)
--
-- CEO 13/05/2026 (tham khảo Fabi/iPos):
--   Cà phê đá tại quán FnB = 25.000đ, nhưng bán qua Shopee Food = 26.000đ
--   (markup để cover commission + phí ship). Cashier KHÔNG đổi giá manual
--   — POS tự pick giá đúng dựa vào tab.deliveryPlatform.
--
-- Khác `price_tiers` (00041): tier gắn vào BRANCH (toàn menu quán Q1 vs
-- quán Thủ Đức). Còn migration này gắn vào PLATFORM (Shopee Food vs Grab
-- vs Tại quán) — orthogonal với branch.
--
-- Setup workflow:
--   - Owner mở `/cai-dat/bang-gia/platforms` (UI bulk matrix) → fill số
--     tiền cho từng SP × từng platform.
--   - Hoặc mở SP detail tại `/hang-hoa` → tab "Giá theo nền tảng" → fill.
--   - Cả 2 UI cùng đọc/ghi 1 bảng này → tự sync.
--   - SP không có override cho platform X → fallback product.sell_price.
-- ============================================================

create table if not exists public.product_platform_prices (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  platform text not null check (platform in (
    'direct',      -- Tại quán (KHÔNG override — luôn = sell_price)
    'shopee_food',
    'grab_food',
    'gojek',
    'be'
  )),
  override_price numeric(15, 2) not null check (override_price >= 0),
  -- Audit
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, product_id, platform)
);

-- Index lookup từ POS: cho SP A, platform B trả 1 row
create index if not exists idx_product_platform_prices_lookup
  on public.product_platform_prices (tenant_id, product_id, platform);

-- Index list theo platform (cho bulk matrix filter Shopee Food)
create index if not exists idx_product_platform_prices_by_platform
  on public.product_platform_prices (tenant_id, platform);

comment on table public.product_platform_prices is
  'Giá bán override theo nền tảng đơn (Shopee Food / Grab / Gojek / Be). Mỗi SP có 1 row per platform có override. Không có row → fallback sell_price.';

-- ────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────
alter table public.product_platform_prices enable row level security;

drop policy if exists "ppp_select_tenant" on public.product_platform_prices;
create policy "ppp_select_tenant" on public.product_platform_prices
  for select using (tenant_id = public.get_user_tenant_id());

-- WRITE: yêu cầu products.manage_prices HOẶC owner (giống bảng giá thường)
drop policy if exists "ppp_write_admin_only" on public.product_platform_prices;
create policy "ppp_write_admin_only" on public.product_platform_prices
  for all
  using (
    tenant_id = public.get_user_tenant_id()
    and (
      public.user_has_permission(auth.uid(), 'products.manage_prices')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  )
  with check (
    tenant_id = public.get_user_tenant_id()
    and (
      public.user_has_permission(auth.uid(), 'products.manage_prices')
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role = 'owner'
      )
    )
  );

-- ────────────────────────────────────────────────────────────────
-- RPC bulk upsert — cho UI bulk matrix lưu nhiều row 1 lần
-- ────────────────────────────────────────────────────────────────
create or replace function public.upsert_product_platform_prices(
  p_rows jsonb  -- [{product_id, platform, override_price}, ...]
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_count int := 0;
  v_row jsonb;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'products.manage_prices') then
    raise exception 'PERMISSION_DENIED: cần quyền products.manage_prices';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    -- Validate
    if (v_row->>'product_id') is null or (v_row->>'platform') is null then
      continue;
    end if;
    if (v_row->>'override_price')::numeric < 0 then
      raise exception 'INVALID_PRICE: giá phải >= 0';
    end if;
    if (v_row->>'platform') not in ('direct','shopee_food','grab_food','gojek','be') then
      raise exception 'INVALID_PLATFORM: %', v_row->>'platform';
    end if;

    insert into public.product_platform_prices
      (tenant_id, product_id, platform, override_price, set_by)
    values (
      v_profile.tenant_id,
      (v_row->>'product_id')::uuid,
      v_row->>'platform',
      (v_row->>'override_price')::numeric,
      v_actor
    )
    on conflict (tenant_id, product_id, platform)
    do update set
      override_price = excluded.override_price,
      set_by = excluded.set_by,
      set_at = now();

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('success', true, 'count', v_count);
end;
$$;

grant execute on function public.upsert_product_platform_prices(jsonb) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- RPC bulk delete — cho UI bulk "Xoá override" theo SP × platform
-- ────────────────────────────────────────────────────────────────
create or replace function public.delete_product_platform_prices(
  p_product_ids uuid[],
  p_platform text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_profile record;
  v_deleted int;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id, tenant_id, role into v_profile
  from public.profiles
  where id = v_actor and is_active = true;

  if not found then
    raise exception 'USER_PROFILE_NOT_FOUND';
  end if;

  if v_profile.role <> 'owner'
     and not public.user_has_permission(v_actor, 'products.manage_prices') then
    raise exception 'PERMISSION_DENIED';
  end if;

  delete from public.product_platform_prices
  where tenant_id = v_profile.tenant_id
    and product_id = any(p_product_ids)
    and platform = p_platform;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('success', true, 'deleted', v_deleted);
end;
$$;

grant execute on function public.delete_product_platform_prices(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
