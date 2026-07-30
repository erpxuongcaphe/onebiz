-- ============================================================
-- 00241 — LỚP 2 đợt 2: bật cách ly cho 30 bảng còn lại
-- ============================================================
-- Nối tiếp 00240 (đã bật 29 bảng có đủ 4 quy tắc). CEO chạy SELECT trên
-- pg_policy → 30 bảng còn lại, mỗi bảng thiếu quy tắc cho vài lệnh.
--
-- ═══ NGUYÊN TẮC AN TOÀN ═══
-- Bật RLS mà thiếu quy tắc cho một lệnh nào đó → lệnh đó bị CHẶN → hỏng
-- tính năng. Nên trước khi bật, file này ĐẢM BẢO mỗi bảng có quy tắc cho
-- CẢ 4 lệnh (đọc/thêm/sửa/xoá). Như vậy bật RLS KHÔNG thể chặn thao tác nào.
--
-- Cách lấy biểu thức quy tắc — KHÔNG tự chế, tái dùng cái đã có:
--   • Bảng CÓ tenant_id  → dùng khuôn chuẩn `tenant_id = get_user_tenant_id()`
--     (đúng khuôn 29 bảng đã bật ở 00240, đã chạy tốt trên web).
--   • Bảng CON (không tenant_id: invoice_items, po_items…) → COPY nguyên
--     biểu thức của quy tắc ĐỌC đã có trên chính bảng đó (qua pg_get_expr).
--     Không đoán cách lọc — dùng đúng cái đang chạy.
--   • Bảng backup → bật RLS KHÔNG quy tắc = client không đọc được (đúng, vì
--     backup không được để lộ, và web không bao giờ đọc chúng — đã quét).
--
-- ⚠️ KHÔNG đụng một dòng dữ liệu nào. Chỉ thêm quy tắc + bật cờ RLS.
-- ⚠️ Đường lùi cuối file.
-- ============================================================

-- ── 1. Ba bảng backup: bật RLS, không quy tắc → client bị chặn hẳn ──
do $$
declare b text;
begin
  foreach b in array array[
    'invoice_items_cost_backup_00237',
    'product_lots_backup_00226',
    'product_lots_backup_00231'
  ]
  loop
    if to_regclass('public.' || b) is not null then
      execute format('alter table public.%I enable row level security', b);
      raise notice '00241: % → RLS bật, chặn client (bảng backup)', b;
    end if;
  end loop;
end $$;

-- ── 2. Bảng CÓ tenant_id: thêm quy tắc thiếu bằng khuôn chuẩn ──
do $$
declare
  b     text;
  lenh  text;
  cmd   char;
  ten   text;
begin
  foreach b in array array[
    'audit_log','branches','cash_transactions','code_sequences','conversations',
    'coupon_usages','delivery_partners','favorites','inventory_checks','invoices',
    'loyalty_settings','loyalty_transactions','notifications','profiles',
    'purchase_orders','sales_channels','shipping_orders','stock_movements','stock_transfers'
  ]
  loop
    if to_regclass('public.' || b) is null then continue; end if;

    -- 4 lệnh: select(r) insert(a) update(w) delete(d)
    foreach lenh in array array['select','insert','update','delete']
    loop
      cmd := case lenh when 'select' then 'r' when 'insert' then 'a'
                       when 'update' then 'w' else 'd' end;
      -- đã có quy tắc cho lệnh này (hoặc quy tắc ALL '*') thì bỏ qua
      if exists (
        select 1 from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname='public' and c.relname=b and p.polcmd in (cmd,'*')
      ) then continue; end if;

      ten := format('%s_%s_00241', b, lenh);
      if lenh = 'insert' then
        execute format(
          'create policy %I on public.%I for insert with check (tenant_id = public.get_user_tenant_id())',
          ten, b);
      elsif lenh = 'update' then
        execute format(
          'create policy %I on public.%I for update using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id())',
          ten, b);
      else
        execute format(
          'create policy %I on public.%I for %s using (tenant_id = public.get_user_tenant_id())',
          ten, b, lenh);
      end if;
      raise notice '00241: + quy tắc %.% (%)', b, lenh, cmd;
    end loop;

    execute format('alter table public.%I enable row level security', b);
  end loop;
end $$;

-- ── 3. Bảng tenants: lọc theo id (chính nó là bảng doanh nghiệp) ──
do $$
begin
  -- Đã có select (id = get_user_tenant_id()). Chỉ cần thêm update cùng khuôn.
  -- KHÔNG thêm insert/delete cho vai trò đăng nhập: tạo/xoá doanh nghiệp chỉ
  -- qua đường quản trị (service role, bỏ qua RLS). Client chỉ sửa settings.
  if not exists (
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='tenants' and p.polcmd in ('w','*')
  ) then
    execute 'create policy tenants_update_00241 on public.tenants for update using (id = public.get_user_tenant_id()) with check (id = public.get_user_tenant_id())';
  end if;
  execute 'alter table public.tenants enable row level security';
  raise notice '00241: tenants → RLS bật (lọc theo id)';
end $$;

-- ── 4. Bảng CON: copy nguyên biểu thức quy tắc ĐỌC đã có ──
-- invoice_items, purchase_order_items, return_items, inventory_check_items,
-- conversation_messages đều đã có quy tắc select scope qua bảng cha → tái dùng.
do $$
declare
  b       text;
  lenh    text;
  cmd     char;
  v_qual  text;
  ten     text;
begin
  foreach b in array array[
    'invoice_items','purchase_order_items','return_items',
    'inventory_check_items','conversation_messages'
  ]
  loop
    if to_regclass('public.' || b) is null then continue; end if;

    -- Lấy biểu thức USING của một quy tắc bất kỳ đang có trên bảng này
    select pg_get_expr(p.polqual, p.polrelid) into v_qual
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relname=b and p.polqual is not null
     limit 1;

    if v_qual is null then
      raise exception '00241: bảng con % không có biểu thức quy tắc để tái dùng — dừng', b;
    end if;

    foreach lenh in array array['select','insert','update','delete']
    loop
      cmd := case lenh when 'select' then 'r' when 'insert' then 'a'
                       when 'update' then 'w' else 'd' end;
      if exists (
        select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
        join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=b and p.polcmd in (cmd,'*')
      ) then continue; end if;

      ten := format('%s_%s_00241', b, lenh);
      if lenh = 'insert' then
        execute format('create policy %I on public.%I for insert with check (%s)', ten, b, v_qual);
      elsif lenh = 'update' then
        execute format('create policy %I on public.%I for update using (%s) with check (%s)', ten, b, v_qual, v_qual);
      else
        execute format('create policy %I on public.%I for %s using (%s)', ten, b, lenh, v_qual);
      end if;
      raise notice '00241: + quy tắc con %.% (copy biểu thức đọc)', b, lenh;
    end loop;

    execute format('alter table public.%I enable row level security', b);
  end loop;
end $$;

-- ── 5. stock_transfer_items: chưa có quy tắc nào → viết mới, lọc qua cha ──
do $$
begin
  if to_regclass('public.stock_transfer_items') is null then return; end if;
  if to_regclass('public.stock_transfers') is null then
    raise exception '00241: thiếu bảng cha stock_transfers';
  end if;

  execute $q$
    create policy stock_transfer_items_all_00241 on public.stock_transfer_items
    for all
    using (exists (select 1 from public.stock_transfers t
                    where t.id = stock_transfer_items.transfer_id
                      and t.tenant_id = public.get_user_tenant_id()))
    with check (exists (select 1 from public.stock_transfers t
                    where t.id = stock_transfer_items.transfer_id
                      and t.tenant_id = public.get_user_tenant_id()))
  $q$;
  execute 'alter table public.stock_transfer_items enable row level security';
  raise notice '00241: stock_transfer_items → quy tắc mới (lọc qua stock_transfers) + RLS bật';
end $$;

-- ── 6. ĐỐI SOÁT: không còn bảng nào RLS tắt (trừ các bảng đã cố ý) ──
do $$
declare v_con int;
begin
  select count(*) into v_con
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
  raise notice '00241 OK: còn % bảng RLS tắt (kỳ vọng 0, hoặc chỉ bảng hệ thống/không tenant).', v_con;
end $$;

notify pgrst, 'reload schema';

-- ============================================================
-- ĐỐI CHIẾU SAU KHI CHẠY — làm đủ, đừng bỏ bước 2
-- ============================================================
-- 1) Không còn bảng nào RLS tắt (trừ bảng cố ý):
-- select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
--
-- 2) ⚠️ MỞ WEB, đăng nhập, đi TRỌN các luồng ghi (đây là phần quan trọng nhất):
--    · Bán 1 đơn POS Retail (đơn nhỏ) → xem hoá đơn + invoice_items + sổ kho
--    · Tạo 1 phiếu nhập nháp → purchase_orders + po_items
--    · Vào Sổ quỹ, Công nợ, Hoá đơn, Nhập hàng, Kiểm kho — đều hiện dữ liệu
--    · Chuông thông báo (notifications) còn chạy
--    Thiếu/chặn ở đâu → chạy đường lùi rồi gọi em.
--
-- ============================================================
-- ĐƯỜNG LÙI — tắt RLS lại cho toàn bộ bảng đợt này
-- ============================================================
-- do $$
-- declare b text;
-- begin
--   foreach b in array array[
--     'invoice_items_cost_backup_00237','product_lots_backup_00226','product_lots_backup_00231',
--     'audit_log','branches','cash_transactions','code_sequences','conversations','coupon_usages',
--     'delivery_partners','favorites','inventory_checks','invoices','loyalty_settings',
--     'loyalty_transactions','notifications','profiles','purchase_orders','sales_channels',
--     'shipping_orders','stock_movements','stock_transfers','tenants','invoice_items',
--     'purchase_order_items','return_items','inventory_check_items','conversation_messages',
--     'stock_transfer_items'
--   ]
--   loop
--     if to_regclass('public.'||b) is not null then
--       execute format('alter table public.%I disable row level security', b);
--     end if;
--   end loop;
-- end $$;
