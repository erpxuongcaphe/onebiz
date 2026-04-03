-- ============================================================
-- OneBiz ERP - Migration 00005: RLS & Functions for New Features
-- ============================================================

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- FAVORITES
alter table public.favorites enable row level security;
create policy "favorites_select" on public.favorites for select using (tenant_id = public.get_user_tenant_id());
create policy "favorites_insert" on public.favorites for insert with check (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());
create policy "favorites_delete" on public.favorites for delete using (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());

-- COUPONS
alter table public.coupons enable row level security;
create policy "coupons_select" on public.coupons for select using (tenant_id = public.get_user_tenant_id());
create policy "coupons_insert" on public.coupons for insert with check (tenant_id = public.get_user_tenant_id());
create policy "coupons_update" on public.coupons for update using (tenant_id = public.get_user_tenant_id());
create policy "coupons_delete" on public.coupons for delete using (tenant_id = public.get_user_tenant_id());

-- COUPON_USAGES
alter table public.coupon_usages enable row level security;
create policy "coupon_usages_select" on public.coupon_usages for select using (tenant_id = public.get_user_tenant_id());
create policy "coupon_usages_insert" on public.coupon_usages for insert with check (tenant_id = public.get_user_tenant_id());

-- PROMOTIONS
alter table public.promotions enable row level security;
create policy "promotions_select" on public.promotions for select using (tenant_id = public.get_user_tenant_id());
create policy "promotions_insert" on public.promotions for insert with check (tenant_id = public.get_user_tenant_id());
create policy "promotions_update" on public.promotions for update using (tenant_id = public.get_user_tenant_id());
create policy "promotions_delete" on public.promotions for delete using (tenant_id = public.get_user_tenant_id());

-- LOYALTY_SETTINGS
alter table public.loyalty_settings enable row level security;
create policy "loyalty_settings_select" on public.loyalty_settings for select using (tenant_id = public.get_user_tenant_id());
create policy "loyalty_settings_insert" on public.loyalty_settings for insert with check (tenant_id = public.get_user_tenant_id());
create policy "loyalty_settings_update" on public.loyalty_settings for update using (tenant_id = public.get_user_tenant_id());

-- LOYALTY_TIERS
alter table public.loyalty_tiers enable row level security;
create policy "loyalty_tiers_select" on public.loyalty_tiers for select using (tenant_id = public.get_user_tenant_id());
create policy "loyalty_tiers_insert" on public.loyalty_tiers for insert with check (tenant_id = public.get_user_tenant_id());
create policy "loyalty_tiers_update" on public.loyalty_tiers for update using (tenant_id = public.get_user_tenant_id());
create policy "loyalty_tiers_delete" on public.loyalty_tiers for delete using (tenant_id = public.get_user_tenant_id());

-- LOYALTY_TRANSACTIONS
alter table public.loyalty_transactions enable row level security;
create policy "loyalty_tx_select" on public.loyalty_transactions for select using (tenant_id = public.get_user_tenant_id());
create policy "loyalty_tx_insert" on public.loyalty_transactions for insert with check (tenant_id = public.get_user_tenant_id());

-- ONLINE_ORDERS
alter table public.online_orders enable row level security;
create policy "online_orders_select" on public.online_orders for select using (tenant_id = public.get_user_tenant_id());
create policy "online_orders_insert" on public.online_orders for insert with check (tenant_id = public.get_user_tenant_id());
create policy "online_orders_update" on public.online_orders for update using (tenant_id = public.get_user_tenant_id());
create policy "online_orders_delete" on public.online_orders for delete using (tenant_id = public.get_user_tenant_id());

-- CONVERSATIONS
alter table public.conversations enable row level security;
create policy "conversations_select" on public.conversations for select using (tenant_id = public.get_user_tenant_id());
create policy "conversations_insert" on public.conversations for insert with check (tenant_id = public.get_user_tenant_id());
create policy "conversations_update" on public.conversations for update using (tenant_id = public.get_user_tenant_id());

-- CONVERSATION_MESSAGES (qua conversation.tenant_id)
alter table public.conversation_messages enable row level security;
create policy "messages_select" on public.conversation_messages for select using (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.tenant_id = public.get_user_tenant_id())
);
create policy "messages_insert" on public.conversation_messages for insert with check (
  exists (select 1 from public.conversations c where c.id = conversation_id and c.tenant_id = public.get_user_tenant_id())
);

-- ============================================================
-- RPC FUNCTIONS
-- ============================================================

-- Toggle favorite (thêm/xóa yêu thích)
create or replace function public.toggle_favorite(
  p_entity_type text,
  p_entity_id uuid
) returns boolean
language plpgsql security definer
as $$
declare
  v_tenant_id uuid;
  v_exists boolean;
begin
  v_tenant_id := public.get_user_tenant_id();

  select exists(
    select 1 from public.favorites
    where user_id = auth.uid()
      and entity_type = p_entity_type
      and entity_id = p_entity_id
  ) into v_exists;

  if v_exists then
    delete from public.favorites
    where user_id = auth.uid()
      and entity_type = p_entity_type
      and entity_id = p_entity_id;
    return false; -- Đã bỏ yêu thích
  else
    insert into public.favorites (tenant_id, user_id, entity_type, entity_id)
    values (v_tenant_id, auth.uid(), p_entity_type, p_entity_id);
    return true; -- Đã thêm yêu thích
  end if;
end;
$$;

-- Validate & apply coupon
create or replace function public.validate_coupon(
  p_code text,
  p_order_amount numeric,
  p_customer_id uuid default null
) returns jsonb
language plpgsql security definer
as $$
declare
  v_tenant_id uuid;
  v_coupon record;
  v_customer_uses integer;
  v_discount numeric;
begin
  v_tenant_id := public.get_user_tenant_id();

  -- Tìm coupon
  select * into v_coupon from public.coupons
  where tenant_id = v_tenant_id
    and upper(code) = upper(p_code)
    and is_active = true;

  if v_coupon is null then
    return jsonb_build_object('valid', false, 'error', 'Mã giảm giá không tồn tại hoặc đã ngưng');
  end if;

  -- Kiểm tra thời hạn
  if v_coupon.start_date is not null and now() < v_coupon.start_date then
    return jsonb_build_object('valid', false, 'error', 'Mã giảm giá chưa có hiệu lực');
  end if;

  if v_coupon.end_date is not null and now() > v_coupon.end_date then
    return jsonb_build_object('valid', false, 'error', 'Mã giảm giá đã hết hạn');
  end if;

  -- Kiểm tra số lần sử dụng
  if v_coupon.max_uses is not null and v_coupon.used_count >= v_coupon.max_uses then
    return jsonb_build_object('valid', false, 'error', 'Mã giảm giá đã hết lượt sử dụng');
  end if;

  -- Kiểm tra đơn hàng tối thiểu
  if p_order_amount < v_coupon.min_order_amount then
    return jsonb_build_object('valid', false, 'error', format('Đơn hàng tối thiểu %sđ', to_char(v_coupon.min_order_amount, 'FM999,999,999')));
  end if;

  -- Kiểm tra số lần dùng/KH
  if p_customer_id is not null and v_coupon.max_uses_per_customer is not null then
    select count(*) into v_customer_uses from public.coupon_usages
    where coupon_id = v_coupon.id and customer_id = p_customer_id;

    if v_customer_uses >= v_coupon.max_uses_per_customer then
      return jsonb_build_object('valid', false, 'error', 'Bạn đã sử dụng mã này rồi');
    end if;
  end if;

  -- Tính giảm giá
  if v_coupon.type = 'percent' then
    v_discount := round(p_order_amount * v_coupon.value / 100);
    if v_coupon.max_discount_amount is not null then
      v_discount := least(v_discount, v_coupon.max_discount_amount);
    end if;
  else
    v_discount := v_coupon.value;
  end if;

  v_discount := least(v_discount, p_order_amount); -- Không giảm quá giá trị đơn

  return jsonb_build_object(
    'valid', true,
    'coupon_id', v_coupon.id,
    'code', v_coupon.code,
    'name', v_coupon.name,
    'type', v_coupon.type,
    'value', v_coupon.value,
    'discount_amount', v_discount
  );
end;
$$;

-- Earn loyalty points (sau khi thanh toán thành công)
create or replace function public.earn_loyalty_points(
  p_customer_id uuid,
  p_invoice_id uuid,
  p_amount numeric
) returns integer
language plpgsql security definer
as $$
declare
  v_tenant_id uuid;
  v_settings record;
  v_points integer;
  v_balance integer;
begin
  v_tenant_id := public.get_user_tenant_id();

  -- Lấy cài đặt tích điểm
  select * into v_settings from public.loyalty_settings
  where tenant_id = v_tenant_id and is_enabled = true;

  if v_settings is null then
    return 0; -- Tích điểm chưa bật
  end if;

  -- Tính điểm
  v_points := floor(p_amount / v_settings.amount_per_point * v_settings.points_per_amount);

  if v_points <= 0 then
    return 0;
  end if;

  -- Cập nhật điểm KH
  update public.customers
  set loyalty_points = loyalty_points + v_points
  where id = p_customer_id and tenant_id = v_tenant_id
  returning loyalty_points into v_balance;

  -- Ghi lịch sử
  insert into public.loyalty_transactions (tenant_id, customer_id, type, points, balance_after, reference_type, reference_id, created_by)
  values (v_tenant_id, p_customer_id, 'earn', v_points, v_balance, 'invoice', p_invoice_id, auth.uid());

  return v_points;
end;
$$;

-- Updated_at triggers cho tables mới
create trigger set_updated_at before update on public.coupons for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.promotions for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.loyalty_settings for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.online_orders for each row execute function public.handle_updated_at();
create trigger set_updated_at before update on public.conversations for each row execute function public.handle_updated_at();
