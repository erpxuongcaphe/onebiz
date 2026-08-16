-- ============================================================================
-- PREFLIGHT — TRUY NGUYÊN 32 đơn vị chênh của NVL-BOT-005 tại Kho Tổng.
-- CHỈ ĐỌC. Không sửa lô, tồn kho, chứng từ. Không tạo migration.
-- Bôi đen toàn bộ → Run. Mã tenant OneBiz đã dán sẵn.
--
-- Bối cảnh: nhân viên CHƯA nhập lô/hạn dùng bằng tay, nhưng hệ thống vẫn tự
-- sinh lô khi nhập hàng, lô DAUKY (00231) và lô ADJ khi đối soát (00284/00285).
-- Vì vậy phải soi đủ cả ba nguồn lô, không chỉ lô nhập hàng.
--
-- KHÔNG mặc định HD001451 / HD001455 là nguyên nhân chỉ vì trùng sản phẩm —
-- mục 5 và 6 dựng dòng thời gian để chỉ ra đúng giao dịch tạo ra chênh lệch.
-- ============================================================================

with t as (
  select '148e8ac5-b891-4de3-9055-cfa41f39ddb0'::uuid as id
),
sp as (
  select p.id, p.code, p.name, p.unit, p.stock
  from public.products p cross join t
  where p.tenant_id = t.id and p.code = 'NVL-BOT-005'
),
cn as (
  select b.id, b.name
  from public.branches b cross join t
  where b.tenant_id = t.id and b.name ilike '%Kho Tổng%'
),
mv as (
  select sm.*,
         sum(case when sm.type = 'in' then sm.quantity else -sm.quantity end)
           over (order by sm.created_at, sm.id
                 rows between unbounded preceding and current row) as so_du_cong_don
  from public.stock_movements sm
  cross join t, sp, cn
  where sm.tenant_id = t.id
    and sm.product_id = sp.id
    and sm.branch_id  = cn.id
)

-- 0. Chốt đối tượng đang soi
select 0 as stt, '0. ĐỐI TƯỢNG' as muc,
       sp.code || ' ' || sp.name || ' | ĐVT=' || coalesce(sp.unit, '?')
    || ' | tồn tổng trên thẻ SP=' || coalesce(sp.stock, 0)::text
    || ' | chi nhánh=' || cn.name as ket_qua,
       null::timestamptz as thoi_diem
from sp, cn

union all
-- 1. Hai con số đang lệch
select 1, '1. HAI CON SỐ ĐANG LỆCH',
       'tồn chi nhánh=' ||
       coalesce((select sum(bs.quantity) from public.branch_stock bs, t, sp, cn
                 where bs.tenant_id = t.id and bs.product_id = sp.id and bs.branch_id = cn.id), 0)::text
    || ' | tổng tồn theo lô=' ||
       coalesce((select sum(pl.current_qty) from public.product_lots pl, t, sp, cn
                 where pl.tenant_id = t.id and pl.product_id = sp.id and pl.branch_id = cn.id), 0)::text,
       null::timestamptz

union all
-- 2. TẤT CẢ lô của sản phẩm này tại kho này
select 2, '2. DANH SÁCH LÔ',
       coalesce(pl.lot_number, '(không mã)')
    || ' | nguồn=' || coalesce(pl.source_type, '?')
    || ' | ban đầu=' || coalesce(pl.initial_qty, 0)::text
    || ' | còn lại=' || coalesce(pl.current_qty, 0)::text
    || ' | trạng thái=' || coalesce(pl.status, '?')
    || ' | phiếu nhập=' || coalesce(pl.purchase_order_id::text, '-')
    || ' | lệnh SX=' || coalesce(pl.production_order_id::text, '-')
    || ' | tạo=' || to_char(pl.created_at, 'DD/MM/YYYY HH24:MI')
    || ' | sửa=' || coalesce(to_char(pl.updated_at, 'DD/MM/YYYY HH24:MI'), '-'),
       pl.created_at
from public.product_lots pl, t, sp, cn
where pl.tenant_id = t.id and pl.product_id = sp.id and pl.branch_id = cn.id

union all
-- 3. Toàn bộ chứng từ kho theo thời gian + số dư cộng dồn
select 3, '3. DÒNG THỜI GIAN CHỨNG TỪ',
       to_char(mv.created_at, 'DD/MM HH24:MI')
    || ' | ' || mv.type || ' ' || mv.quantity::text
    || ' | loại=' || coalesce(mv.reference_type, '?')
    || ' | mã tham chiếu=' || coalesce(mv.reference_id::text, '-')
    || ' | số dư cộng dồn=' || mv.so_du_cong_don::text
    || ' | ghi chú=' || left(coalesce(mv.note, ''), 60),
       mv.created_at
from mv

union all
-- 4. Cấp phát lô: số lượng, nguồn, đã đảo hay chưa
select 4, '4. CẤP PHÁT LÔ',
       coalesce(pl.lot_number, '(không mã)')
    || ' | nguồn=' || coalesce(la.source_type, '?')
    || ' | mã nguồn=' || coalesce(la.source_id::text, '-')
    || ' | số lượng=' || coalesce(la.quantity, 0)::text
    || ' | đã đảo=' || case when la.reverted_at is null then 'CHƯA' else 'RỒI ' || to_char(la.reverted_at, 'DD/MM HH24:MI') end
    || ' | lý do đảo=' || coalesce(la.reverted_reason, '-'),
       la.allocated_at
from public.lot_allocations la
join public.product_lots pl on pl.id = la.lot_id
cross join t, sp, cn
where la.tenant_id = t.id and pl.product_id = sp.id and pl.branch_id = cn.id

union all
-- 5. Nhật ký các lần hệ thống cân lô cho sản phẩm này
select 5, '5. NHẬT KÝ CÂN LÔ',
       to_char(a.created_at, 'DD/MM HH24:MI')
    || ' | thao tác=' || coalesce(a.action, '?')
    || ' | loại đối tượng=' || coalesce(a.entity_type, '?')
    || ' | dữ liệu mới=' || left(coalesce(a.new_data::text, ''), 150),
       a.created_at
from public.audit_log a
cross join t, sp
where a.tenant_id = t.id
  and (a.action ilike '%lot%' or a.action ilike '%reconcile%')
  and (a.entity_id = sp.id or a.new_data::text like '%' || sp.id::text || '%')

union all
-- 6. Lô nào tự sinh (DAUKY / ADJ / đối soát) — nguồn dễ tạo dư nhất
select 6, '6. LÔ TỰ SINH (DAUKY / ADJ / đối soát)',
       coalesce(pl.lot_number, '(không mã)')
    || ' | nguồn=' || coalesce(pl.source_type, '?')
    || ' | ban đầu=' || coalesce(pl.initial_qty, 0)::text
    || ' | còn lại=' || coalesce(pl.current_qty, 0)::text
    || ' | tạo=' || to_char(pl.created_at, 'DD/MM/YYYY HH24:MI'),
       pl.created_at
from public.product_lots pl, t, sp, cn
where pl.tenant_id = t.id and pl.product_id = sp.id and pl.branch_id = cn.id
  and (coalesce(pl.lot_number, '') ilike '%DAUKY%'
       or coalesce(pl.lot_number, '') ilike '%ADJ%'
       or coalesce(pl.source_type, '') in ('reconciliation', 'adjustment', 'opening'))

union all
-- 7. Hai hoá đơn bị nghi — CHỈ để đối chiếu, chưa kết luận
select 7, '7. HAI HOÁ ĐƠN BỊ NGHI (chỉ đối chiếu)',
       i.code || ' | nguồn=' || coalesce(i.source, '?')
    || ' | trạng thái=' || coalesce(i.status, '?')
    || ' | huỷ lúc=' || coalesce(to_char(i.voided_at, 'DD/MM/YYYY HH24:MI'), 'KHÔNG CÓ MỐC HUỶ')
    || ' | tạo lúc=' || to_char(i.created_at, 'DD/MM/YYYY HH24:MI'),
       i.created_at
from public.invoices i cross join t
where i.tenant_id = t.id and i.code in ('HD001451', 'HD001455')

order by 1, 4 nulls first, 3;
