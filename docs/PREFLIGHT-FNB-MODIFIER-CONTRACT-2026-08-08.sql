-- ============================================================================
-- PREFLIGHT — HỢP ĐỒNG TUỲ CHỌN MÓN F&B  (08/08/2026)
--
-- CHỈ ĐỌC. Toàn bộ là SELECT. Không tạo, không sửa, không xoá, không gọi RPC
-- ghi. Chạy bao nhiêu lần cũng vô hại.
--
-- Mục đích: xác nhận trên Supabase THẬT rằng các cột và truy vấn mà web đang
-- dùng sau PR #146 đều có thật và chạy được — thay vì chỉ tin vào test giả lập.
--
-- Cách chạy: Supabase → SQL Editor → dán cả tệp → Run. Đọc lần lượt 6 bảng
-- kết quả. Cột `ket_luan` nói thẳng đạt hay không.
-- ============================================================================

-- ── 1. Ba cột web đang đọc có tồn tại không ────────────────────────────────
SELECT
  'A1. Cột bắt buộc' AS muc,
  t.bang,
  t.cot,
  CASE WHEN c.column_name IS NULL THEN '❌ THIẾU' ELSE '✅ có (' || c.data_type || ')' END
    AS ket_luan
FROM (VALUES
  ('modifier_groups',          'channel'),
  ('modifier_groups',          'sort_order'),
  ('modifier_groups',          'is_active'),
  ('modifier_groups',          'rule'),
  ('product_modifier_groups',  'rule_override'),
  ('product_modifier_groups',  'sort_order'),
  ('category_modifier_groups', 'sort_order')
) AS t(bang, cot)
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = t.bang AND c.column_name = t.cot
ORDER BY t.bang, t.cot;

-- ── 2. category_modifier_groups có rule_override không ────────────────────
-- Máy chủ dùng coalesce(link.rule_override, group.rule). Cấp NHÓM HÀNG hiện
-- KHÔNG có cột này → không ghi đè được ở cấp nhóm hàng. Đây là hiện trạng đã
-- biết, ghi ra để khỏi ai nhầm.
SELECT
  'A2. Ghi đè cấp nhóm hàng' AS muc,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'category_modifier_groups'
      AND column_name = 'rule_override'
  ) THEN 'có cột rule_override'
    ELSE 'KHÔNG có — chỉ ghi đè được ở cấp món (đúng thiết kế hiện tại)'
  END AS ket_luan;

-- ── 3. Giá trị channel đang tồn tại + nhóm nào sẽ bị lọc ──────────────────
-- Web (và máy chủ) chỉ nhận 'fnb' hoặc 'all'. Dòng nào ❌ là nhóm đang bật
-- nhưng POS F&B sẽ KHÔNG hiện — kiểm xem có phải gán nhầm không.
SELECT
  'B. Kênh của nhóm tuỳ chọn' AS muc,
  g.name          AS ten_nhom,
  g.rule          AS quy_tac,
  g.channel       AS kenh,
  g.sort_order    AS thu_tu_nhom,
  g.is_active     AS dang_dung,
  CASE
    WHEN NOT g.is_active            THEN '— đã tắt, không xét'
    WHEN g.channel IN ('fnb','all') THEN '✅ hiện trên POS F&B'
    ELSE                                 '❌ ĐANG BẬT nhưng kênh ' || g.channel || ' → POS F&B ẩn'
  END AS ket_luan
FROM public.modifier_groups g
ORDER BY g.is_active DESC, g.channel, g.name;

-- ── 4. Truy vấn web đang dùng — chạy y hệt ────────────────────────────────
-- Tương đương: .in("id", …).eq("is_active", true).in("channel", ["fnb","all"])
-- kèm đếm số lựa chọn. Chạy được = hợp đồng đúng.
SELECT
  'C. Truy vấn web' AS muc,
  g.id,
  g.name        AS ten_nhom,
  g.rule        AS quy_tac,
  g.channel     AS kenh,
  count(o.id)   AS so_lua_chon,
  CASE WHEN count(o.id) = 0
       THEN '⚠ nhóm rỗng — popup sẽ bỏ qua'
       ELSE '✅' END AS ket_luan
FROM public.modifier_groups g
LEFT JOIN public.modifier_options o
  ON o.group_id = g.id AND o.is_active
WHERE g.is_active
  AND g.channel IN ('fnb', 'all')
GROUP BY g.id, g.name, g.rule, g.channel
ORDER BY g.name;

-- ── 5. rule_override cấp món — có ai dùng chưa ────────────────────────────
SELECT
  'D. Ghi đè quy tắc cấp món' AS muc,
  count(*)                                        AS tong_lien_ket,
  count(*) FILTER (WHERE rule_override IS NOT NULL) AS co_ghi_de,
  CASE WHEN count(*) = 0
       THEN 'chưa có liên kết cấp món nào → bản sửa mang tính phòng ngừa'
       ELSE 'có liên kết cấp món — kiểm cột co_ghi_de'
  END AS ket_luan
FROM public.product_modifier_groups;

-- ── 6. Thứ tự liên kết có khác thứ tự nhóm không ──────────────────────────
-- Câu hỏi thật: người quản lý sắp thứ tự ở LIÊN KẾT, web (trước PR #146) lại
-- sắp theo sort_order của NHÓM. Có nhóm hàng nào ra hai thứ tự khác nhau?
WITH lk AS (
  SELECT
    c.category_id,
    c.modifier_group_id,
    c.sort_order                            AS thu_tu_lien_ket,
    g.sort_order                            AS thu_tu_nhom,
    g.name                                  AS ten_nhom
  FROM public.category_modifier_groups c
  JOIN public.modifier_groups g ON g.id = c.modifier_group_id
  WHERE g.is_active AND g.channel IN ('fnb','all')
),
xep AS (
  SELECT
    category_id,
    string_agg(ten_nhom, ' → ' ORDER BY thu_tu_lien_ket, ten_nhom) AS theo_lien_ket,
    string_agg(ten_nhom, ' → ' ORDER BY thu_tu_nhom,     ten_nhom) AS theo_nhom,
    count(*)                                                       AS so_nhom,
    count(DISTINCT thu_tu_nhom)                                    AS so_gia_tri_thu_tu_nhom
  FROM lk
  GROUP BY category_id
)
SELECT
  'E. Thứ tự liên kết vs thứ tự nhóm' AS muc,
  x.category_id,
  cat.name        AS ten_nhom_hang,
  x.so_nhom,
  x.theo_lien_ket,
  x.theo_nhom,
  CASE
    WHEN x.so_nhom < 2                     THEN '— 1 nhóm, không so được'
    WHEN x.theo_lien_ket <> x.theo_nhom    THEN '❗ LỆCH — trước PR #146 hiện sai ý người quản lý'
    WHEN x.so_gia_tri_thu_tu_nhom = 1      THEN '⚠ trùng khớp NHƯNG thứ tự nhóm toàn số giống nhau → trước đây thứ tự do CSDL tự quyết, không đảm bảo'
    ELSE                                        '✅ khớp'
  END AS ket_luan
FROM xep x
LEFT JOIN public.categories cat ON cat.id = x.category_id
ORDER BY x.so_nhom DESC, ten_nhom_hang;
