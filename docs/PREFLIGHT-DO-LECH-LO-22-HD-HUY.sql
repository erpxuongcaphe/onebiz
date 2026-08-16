-- ============================================================================
-- PREFLIGHT — ĐO mức lệch sổ lô của các hoá đơn ĐÃ HUỶ trước khi có 00329.
-- CHỈ ĐỌC. Không sửa một dòng dữ liệu nào. Không tạo migration nắn lịch sử.
-- Bôi đen toàn bộ → Run. Mã tenant OneBiz đã dán sẵn.
--
-- BỐI CẢNH: trước 00329, khi huỷ hoá đơn, phần nguyên liệu tiêu hao theo công
-- thức (movement 'bom_consume' / 'modifier_topping') được hoàn TỒN nhưng KHÔNG
-- được đảo SỔ LÔ. Nên tồn chi nhánh có thể đúng trong khi tổng tồn theo lô
-- thiếu đúng bằng phần đã tiêu hao đó.
--
-- Cách đo: so TỒN CHI NHÁNH với TỔNG TỒN THEO LÔ của cùng (chi nhánh, sản phẩm),
-- chỉ xét những sản phẩm thực sự dính tới các hoá đơn đã huỷ.
-- ============================================================================

with t as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as id
),
-- Các hoá đơn đã huỷ (đếm theo mã hoá đơn, không đếm theo dòng chứng từ)
hd_huy as (
  select distinct sm.reference_id as invoice_id
  from public.stock_movements sm
  cross join t
  where sm.tenant_id = t.id and sm.reference_type = 'invoice_void'
),
-- Cặp (chi nhánh, sản phẩm) từng bị hoàn khi huỷ — đây là vùng nghi ngờ
cap_anh_huong as (
  select distinct sm.branch_id, sm.product_id
  from public.stock_movements sm
  cross join t
  join hd_huy h on h.invoice_id = sm.reference_id
  where sm.tenant_id = t.id
    and sm.reference_type = 'invoice_void'
    and sm.type = 'in'
    and sm.branch_id is not null
    and sm.product_id is not null
),
-- Tồn theo sổ lô
ton_lo as (
  select pl.branch_id, pl.product_id, sum(pl.current_qty) as ton_lo
  from public.product_lots pl
  cross join t
  where pl.tenant_id = t.id
  group by pl.branch_id, pl.product_id
),
-- Tồn chi nhánh
ton_cn as (
  select bs.branch_id, bs.product_id, sum(bs.quantity) as ton_chi_nhanh
  from public.branch_stock bs
  cross join t
  where bs.tenant_id = t.id
  group by bs.branch_id, bs.product_id
),
lech as (
  select c.branch_id, c.product_id,
         coalesce(tc.ton_chi_nhanh, 0) as ton_chi_nhanh,
         coalesce(tl.ton_lo, 0)        as ton_lo,
         coalesce(tc.ton_chi_nhanh, 0) - coalesce(tl.ton_lo, 0) as chenh
  from cap_anh_huong c
  left join ton_cn tc on tc.branch_id = c.branch_id and tc.product_id = c.product_id
  left join ton_lo tl on tl.branch_id = c.branch_id and tl.product_id = c.product_id
)

-- 1. Quy mô: bao nhiêu hoá đơn đã huỷ, tách theo kênh
select 1 as stt, '1. HOÁ ĐƠN ĐÃ HUỶ (theo mã, tách kênh)' as muc,
       coalesce(string_agg(x.nguon || ': ' || x.so_hd::text || ' hoá đơn', ' | ' order by x.nguon),
                'KHÔNG CÓ') as ket_qua
from (
  select coalesce(i.source, '(không rõ)') as nguon, count(distinct h.invoice_id) as so_hd
  from hd_huy h
  cross join t
  left join public.invoices i on i.id = h.invoice_id and i.tenant_id = t.id
  group by coalesce(i.source, '(không rõ)')
) x

union all
-- 2. Tổng quan mức lệch
select 2, '2. TỔNG QUAN LỆCH',
       'số cặp (chi nhánh × sản phẩm) đã soi=' || count(*)::text
    || ' | KHỚP=' || count(*) filter (where abs(chenh) < 0.0001)::text
    || ' | LỆCH=' || count(*) filter (where abs(chenh) >= 0.0001)::text
from lech

union all
-- 3. Chi tiết từng dòng lệch (tên sản phẩm + chi nhánh + mức chênh)
select 3, '3. CHI TIẾT LỆCH',
       b.name || ' | ' || p.code || ' ' || p.name
    || ' | tồn chi nhánh=' || l.ton_chi_nhanh::text
    || ' | tồn theo lô=' || l.ton_lo::text
    || ' | chênh=' || l.chenh::text
from lech l
join public.products p on p.id = l.product_id
join public.branches b on b.id = l.branch_id
where abs(l.chenh) >= 0.0001

union all
-- 4. Hoá đơn nào dính sản phẩm lệch (truy ngược để biết ca nào gây ra)
select 4, '4. HOÁ ĐƠN LIÊN QUAN DÒNG LỆCH',
       i.code || ' | nguồn=' || coalesce(i.source, '?')
    || ' | huỷ lúc=' || coalesce(i.voided_at::text, '?')
    || ' | số sản phẩm lệch=' || count(distinct l.product_id)::text
from public.stock_movements sm
cross join t
join lech l on l.branch_id = sm.branch_id and l.product_id = sm.product_id
join public.invoices i on i.id = sm.reference_id and i.tenant_id = t.id
where sm.tenant_id = t.id
  and sm.reference_type = 'invoice_void'
  and abs(l.chenh) >= 0.0001
group by i.code, i.source, i.voided_at

union all
-- 5. Nguyên nhân: cấp phát lô của hoá đơn đã huỷ mà CHƯA được đảo
select 5, '5. NGUYÊN NHÂN — cấp phát lô chưa đảo',
       'số bản ghi cấp phát lô thuộc hoá đơn đã huỷ nhưng chưa đảo=' || count(*)::text
    || ' | tổng số lượng=' || coalesce(sum(la.quantity), 0)::text
from public.lot_allocations la
cross join t
join hd_huy h on h.invoice_id = la.source_id
where la.tenant_id = t.id
  and la.source_type = 'invoice'
  and la.reverted_at is null

union all
-- 6. Đối chiếu: cấp phát lô ĐÃ được đảo (phần vòng 'invoice' xử lý đúng)
select 6, '6. ĐỐI CHIẾU — cấp phát lô đã đảo',
       'số bản ghi đã đảo=' || count(*)::text
    || ' | tổng số lượng=' || coalesce(sum(la.quantity), 0)::text
from public.lot_allocations la
cross join t
join hd_huy h on h.invoice_id = la.source_id
where la.tenant_id = t.id
  and la.source_type = 'invoice'
  and la.reverted_at is not null

order by 1, 3;
