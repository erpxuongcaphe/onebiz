-- ============================================================
-- PREFLIGHT F&B TOPPING — CHỈ ĐỌC. Bản 5 (07/08/2026)
--
-- VÌ SAO GỘP LẠI: SQL Editor của Supabase CHỈ HIỆN KẾT QUẢ CỦA LỆNH CUỐI.
-- Bản 4 có 15 lệnh → CEO chỉ thấy 1 kết quả, 14 phần kia bị nuốt.
-- Nay chỉ còn 2 LỆNH, mỗi lệnh trả về ĐÚNG MỘT kết quả.
--
-- Lịch sử lỗi các bản trước (để không lặp lại):
--   b2: pg_get_functiondef() ném lỗi 42809 trên hàm tổng hợp → thiếu prokind='f'
--   b3: đoán sai `invoices.channel` (thật ra là `source`)
--   b4: đoán sai `bom.output_quantity` (thật ra là yield_qty/yield_unit/batch_size)
--   → Mọi cột dưới đây ĐÃ đối chiếu với src/__tests__/schema/db-schema.json
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- LỆNH 1 — TOÀN BỘ SỐ LIỆU, TRẢ VỀ MỘT Ô JSON DUY NHẤT
-- Chạy → bấm vào ô kết quả → Copy → dán lại cho Claude.
-- ══════════════════════════════════════════════════════════════
select jsonb_pretty(jsonb_build_object(

  'moi_truong', jsonb_build_object(
    'postgres', version(),
    'csdl', current_database()
  ),

  -- ── 5 hàm: tồn tại + bản quá tải + vân tay ──
  'cac_ham', (
    select jsonb_agg(jsonb_build_object(
      'ten', p.proname,
      'tham_so', pg_get_function_identity_arguments(p.oid),
      'security_definer', p.prosecdef,
      'van_tay', md5(pg_get_functiondef(p.oid)),
      'do_dai', length(pg_get_functiondef(p.oid))
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.prokind='f'
      and p.proname in ('fnb_send_to_kitchen_atomic','fnb_send_to_kitchen_atomic_v2',
                        'fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230',
                        'consume_bom_for_sale')
  ),

  -- ★ ĐIỂM NGHI NGỜ CHÍNH: gửi bếp GHI khoá nào, thanh toán ĐỌC khoá nào ──
  'hop_dong_khoa_json', (
    select jsonb_agg(jsonb_build_object(
      'ten_ham', p.proname,
      'ghi_productId',  (select count(*) from regexp_matches(d,'''productId''','g')),
      'ghi_product_id', (select count(*) from regexp_matches(d,'''product_id''','g')),
      'doc_productId',  (select count(*) from regexp_matches(d,'->>\s*''productId''','g')),
      'doc_product_id', (select count(*) from regexp_matches(d,'->>\s*''product_id''','g'))
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral (select pg_get_functiondef(p.oid) as d) x
    where n.nspname='public' and p.prokind='f'
      and p.proname in ('fnb_send_to_kitchen_atomic','fnb_send_to_kitchen_atomic_v2',
                        'fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230',
                        'consume_bom_for_sale')
  ),

  -- ── consume_bom_for_sale xử lý những gì ──
  'consume_bom', (
    select jsonb_agg(jsonb_build_object(
      'tham_so', pg_get_function_identity_arguments(p.oid),
      'xu_ly_linkedProductId', d like '%linkedProductId%',
      'nhan_modifier_selections', d like '%p_modifier_selections%',
      'xu_ly_he_so_scale', (d like '%scale_factor%' or d like '%scaleFactor%'),
      'so_lan_tru_ton_chi_nhanh', (select count(*) from regexp_matches(d,'upsert_branch_stock','g')),
      'so_lan_tru_ton_tong',      (select count(*) from regexp_matches(d,'increment_product_stock','g')),
      'so_lan_tru_lo_fifo',       (select count(*) from regexp_matches(d,'allocate_lots_fifo','g'))
    ))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral (select pg_get_functiondef(p.oid) as d) x
    where n.nspname='public' and p.prokind='f' and p.proname='consume_bom_for_sale'
  ),

  -- ── hàm nào khoá cứng NVL-TOP ──
  'ham_khoa_cung_NVL_TOP', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'ten', p.proname,
      'so_lan', (select count(*) from regexp_matches(d,'NVL-TOP','g'))
    ) order by p.proname), '[]'::jsonb)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    cross join lateral (select pg_get_functiondef(p.oid) as d) x
    where n.nspname='public' and p.prokind='f' and d like '%NVL-TOP%'
  ),

  -- ── dữ liệu đã phát sinh thật sự ──
  'da_phat_sinh', jsonb_build_object(
    'tong_don_bep',        (select count(*) from public.kitchen_orders),
    'tong_dong_don_bep',   (select count(*) from public.kitchen_order_items),
    'dong_co_topping_that',(select count(*) from public.kitchen_order_items
                              where jsonb_array_length(coalesce(toppings,'[]'::jsonb))>0),
    'dong_co_modifier_that',(select count(*) from public.kitchen_order_items
                              where jsonb_array_length(coalesce(modifier_selections,'[]'::jsonb))>0),
    'so_kho_tu_modifier',  (select count(*) from public.stock_movements where reference_type='modifier_topping'),
    'so_kho_tu_topping_cu',(select count(*) from public.stock_movements where note ilike 'Topping %'),
    'don_bep_da_ra_hoa_don',(select count(*) from public.kitchen_orders where invoice_id is not null),
    'hoa_don_theo_nguon',  (select coalesce(jsonb_agg(jsonb_build_object(
                               'nguon', coalesce(source,'(rỗng)'), 'trang_thai', status, 'so_luong', c)),'[]'::jsonb)
                             from (select source, status, count(*) c from public.invoices
                                   group by source, status order by c desc limit 20) z)
  ),

  -- ── 3 nhóm mã: NVL-TOP / SKU-TOP / SKU-TPP ──
  'ba_nhom_ma', (
    select jsonb_agg(jsonb_build_object(
      'nhom', case when p.code like 'NVL-TOP%' then '1-NGUYEN-LIEU'
                   when p.code like 'SKU-TOP%' then '2-BAN-NGUYEN-TUI'
                   else '3-TOPPING-THEO-PHAN' end,
      'ma', p.code, 'ten', p.name,
      'loai', p.product_type, 'kenh', p.channel, 'vai_tro_ton', p.inventory_role,
      'dvt', p.unit, 'dvt_mua', p.purchase_unit, 'dvt_kho', p.stock_unit, 'dvt_ban', p.sell_unit,
      'gia_ban', p.sell_price, 'gia_von', p.cost_price, 'ton', p.stock,
      'co_bom', p.has_bom, 'ma_bom', p.bom_code, 'dang_bat', p.is_active,
      'ls_phieu_nhap', (select count(*) from public.purchase_order_items t where t.product_id=p.id),
      'ls_hoa_don',    (select count(*) from public.invoice_items t      where t.product_id=p.id),
      'ls_so_kho',     (select count(*) from public.stock_movements t    where t.product_id=p.id),
      'ls_lam_nvl',    (select count(*) from public.bom_items t          where t.material_id=p.id),
      'ls_ton_cn',     (select count(*) from public.branch_stock t       where t.product_id=p.id),
      'so_lua_chon_noi_toi',(select count(*) from public.modifier_options t where t.linked_product_id=p.id)
    ) order by p.code)
    from public.products p
    where p.code like 'NVL-TOP%' or p.code like 'SKU-TOP%' or p.code like 'SKU-TPP%'
  ),

  -- ── công thức liên quan 3 nhóm ──
  'cong_thuc_lien_quan', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'sp_dau_ra', po.code, 'ten_sp', po.name, 'dvt_dau_ra', po.unit,
      'ma_ct', b.code, 'san_luong', b.yield_qty, 'dvt_san_luong', b.yield_unit, 'co_me', b.batch_size,
      'nguyen_lieu', pm.code, 'ten_nvl', pm.name, 'dvt_nvl', pm.unit,
      'dinh_luong', bi.quantity, 'dvt_trong_ct', bi.unit, 'hao_hut', bi.waste_percent
    )),'[]'::jsonb)
    from public.bom_items bi
    join public.bom b on b.id=bi.bom_id
    join public.products pm on pm.id=bi.material_id
    left join public.products po on po.id=b.product_id
    where pm.code like 'NVL-TOP%' or pm.code like 'SKU-TOP%' or pm.code like 'SKU-TPP%'
       or po.code like 'NVL-TOP%' or po.code like 'SKU-TOP%' or po.code like 'SKU-TPP%'
  ),

  -- ── nhóm tuỳ chọn: thứ tự, luật, mặc định, liên kết ──
  'nhom_tuy_chon', (
    select jsonb_agg(jsonb_build_object(
      'thu_tu', g.sort_order, 'ten', g.name, 'luat', g.rule, 'dang_bat', g.is_active,
      'so_lua_chon', (select count(*) from public.modifier_options o where o.group_id=g.id),
      'so_mac_dinh', (select count(*) from public.modifier_options o where o.group_id=g.id and o.is_default),
      'so_noi_sku',  (select count(*) from public.modifier_options o where o.group_id=g.id and o.linked_product_id is not null),
      'so_nhom_hang_gan',(select count(*) from public.category_modifier_groups l where l.modifier_group_id=g.id),
      'so_mon_gan_rieng',(select count(*) from public.product_modifier_groups l where l.modifier_group_id=g.id),
      'cac_lua_chon', (select coalesce(jsonb_agg(jsonb_build_object(
            'thu_tu', o.sort_order, 'nhan', o.label, 'phu_thu', o.price_delta,
            'he_so', o.scale_factor, 'mac_dinh', o.is_default,
            'sku_noi', lp.code, 'dvt_sku', lp.unit, 'gia_sku', lp.sell_price
          ) order by o.sort_order),'[]'::jsonb)
        from public.modifier_options o
        left join public.products lp on lp.id=o.linked_product_id
        where o.group_id=g.id)
    ) order by g.sort_order, g.name)
    from public.modifier_groups g
  ),

  -- ── cơ chế đơn vị tính ──
  'don_vi_tinh', jsonb_build_object(
    'bang_quy_doi', (select coalesce(jsonb_agg(jsonb_build_object(
                        'tu', from_unit, 'sang', to_unit, 'he_so', factor,
                        'dang_bat', is_active, 'so_sp', c)),'[]'::jsonb)
                      from (select from_unit,to_unit,factor,is_active,count(*) c
                            from public.uom_conversions
                            group by from_unit,to_unit,factor,is_active order by c desc) z),
    'ham_doc_bang_quy_doi', (select coalesce(jsonb_agg(p.proname order by p.proname),'[]'::jsonb)
                              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                              cross join lateral (select pg_get_functiondef(p.oid) as d) x
                              where n.nspname='public' and p.prokind='f' and d like '%uom_conversions%')
  )

)) as ket_qua_preflight;


-- ══════════════════════════════════════════════════════════════
-- LỆNH 2 — TRÍCH THÂN HÀM (chạy RIÊNG sau khi gửi kết quả Lệnh 1)
-- ══════════════════════════════════════════════════════════════
select p.proname as ten_ham,
       substring(d from greatest(position('topping' in d) - 200, 1) for 2500) as doan_lien_quan_topping
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (select pg_get_functiondef(p.oid) as d) x
where n.nspname='public' and p.prokind='f'
  and p.proname in ('fnb_send_to_kitchen_atomic','fnb_send_to_kitchen_atomic_v2',
                    'fnb_complete_payment_atomic','_fnb_complete_payment_impl_00230')
  and d like '%topping%'
order by p.proname;

-- ============================================================
-- HẾT — chỉ SELECT, không ghi bất kỳ dòng nào.
-- ============================================================
