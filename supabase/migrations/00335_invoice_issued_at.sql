-- ============================================================================
-- 00335 — NGÀY HOÁ ĐƠN (invoices.issued_at) — 20/08/2026
--
-- ĐÃ CHẠY PRODUCTION qua bộ vận hành SQL-CAN-CHAY/00335-PHA-A-* và
-- 00335-PHA-A2-* (Pha A: 20/08/2026). File này là BẢN SAO PHẦN LƯỢC ĐỒ để
-- dựng môi trường mới và để scripts/dump-db-schema.mjs có nguồn đối chiếu.
--
-- ⚠️ PHẦN KHÔNG NẰM TRONG FILE NÀY (cố ý):
--   • Vá các RPC báo cáo sang issued_at — nằm ở SQL-CAN-CHAY/00335-PHA-A-*
--     (khối 5a/5b/5c) và 00335-PHA-A3-*, vì chúng vá TẠI CHỖ trên định nghĩa
--     ĐANG CÀI kèm fingerprint md5 của production; môi trường mới phải chạy
--     riêng sau khi đã có 00198/00199/00305.
--   • v4/v6 + seed quyền — nằm ở SQL-CAN-CHAY/00335-PHA-B-* (Pha B, CHƯA chạy).
--     Khối seed dùng role_id của tenant production nên KHÔNG đưa vào đây.
--
-- Idempotent: chạy lặp an toàn.
-- ============================================================================

begin;

-- ── Khối 1. Hai cột mới ────────────────────────────────────────────────────
alter table public.invoices add column if not exists issued_at timestamptz;

-- (Blocker 2 CEO 20/08) KHÔNG dùng timestamp client chưa xác thực làm ngày kế
-- toán. Thời điểm bấm thanh toán khi mất mạng lưu ở cột NGHIỆP VỤ RIÊNG này,
-- KHÔNG có báo cáo nào đọc, KHÔNG ảnh hưởng doanh thu.
alter table public.invoices add column if not exists checkout_client_at timestamptz;

comment on column public.invoices.issued_at is
  '00335: NGÀY HOÁ ĐƠN (ngày phát hành chứng từ bán). NULL = chưa phát hành '
  '(nháp, đơn đặt, huỷ trước khi bán). Hoá đơn đã phát hành rồi huỷ GIỮ NGUYÊN '
  'issued_at. KHÔNG thay thế created_at (audit tạo bản ghi). Chỉ ghi được qua '
  'trigger + RPC v4/v6 — trigger chặn mọi đường ghi thẳng. Doanh thu / danh '
  'sách hoá đơn / bản in / Excel / KPI lọc theo cột này; ca, sổ quỹ, kho, bếp '
  'giữ thời gian giao dịch thật.';

comment on column public.invoices.checkout_client_at is
  '00335: Thời điểm máy bán hàng bấm thanh toán khi mất mạng, do CLIENT gửi — '
  'THAM KHẢO/ĐỐI SOÁT, KHÔNG xác thực, KHÔNG dùng cho kế toán, KHÔNG báo cáo '
  'nào lọc theo cột này. Ngày hoá đơn của đơn đồng bộ offline = giờ máy chủ '
  'lúc đồng bộ (issued_at).';

-- ── Khối 2. Index (EXPLAIN 50k dòng local, xem bản trình) ──────────────────
-- Lọc issued_at thẳng: Index Scan 0.24ms. Lọc coalesce: Seq Scan 38ms →
-- expression index đưa về Bitmap Index Scan 1.0ms.
create index if not exists idx_invoices_tenant_branch_issued
  on public.invoices (tenant_id, branch_id, issued_at desc)
  where issued_at is not null;

create index if not exists idx_invoices_tenant_ngay_hd
  on public.invoices (tenant_id, (coalesce(issued_at, created_at)) desc);

-- ── Khối 3. Trigger PHA A: chặn ghi thẳng + SOI GƯƠNG created_at ───────────
create or replace function public.trg_invoices_issued_at_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
-- 00335_PHA_A — issued_at = created_at (KHÔNG đổi hành vi). Pha B sẽ thay
-- thân hàm này để chuyển sang now() sau khi toàn bộ client đọc issued_at.
declare
  v_bypass boolean :=
    coalesce(current_setting('app.issued_at_bypass', true), '') = '1';
begin
  -- CHẶN ghi issued_at ngoài luồng cho phép — kể cả PATCH REST/devtools.
  -- Bypass chỉ mở bằng set_config(..., true) trong transaction của migration
  -- hoặc RPC; PostgREST không expose pg_catalog.set_config nên client không
  -- tự mở được.
  if not v_bypass then
    if tg_op = 'INSERT' and new.issued_at is not null then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHOA: không được ghi issued_at trực tiếp';
    end if;
    if tg_op = 'UPDATE' and new.issued_at is distinct from old.issued_at then
      raise exception using errcode = '42501',
        message = 'ISSUED_AT_KHOA: không được sửa issued_at trực tiếp';
    end if;
  end if;

  -- Điền KHI PHÁT HÀNH: INSERT thẳng completed, hoặc CHUYỂN sang completed.
  -- PHA A: lấy created_at để mọi màn ra cùng một ngày (không có cửa sổ lệch).
  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.issued_at is null then
    new.issued_at := coalesce(new.created_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_default_issued_at on public.invoices;
drop trigger if exists invoices_issued_at_guard on public.invoices;
create trigger invoices_issued_at_guard
  before insert or update on public.invoices
  for each row execute function public.trg_invoices_issued_at_guard();

-- ── Khối 4. Backfill MỘT LẦN: completed ← created_at ───────────────────────
-- Preflight A05 (19/08): 272 completed · TOÀN HỆ 0 bản ghi voided_at · nhóm
-- huỷ 0 sổ kho → KHÔNG có ca huỷ nào đủ bằng chứng "đã phát hành rồi huỷ"
-- → nhóm huỷ, nháp, đơn đặt giữ NULL.
-- 70 ca completed mang ngày nháp (A06): KHÔNG bulk update — xử từng chứng từ
-- theo 00335-BAO-CAO-NGOAI-LE.sql.
select set_config('app.issued_at_bypass', '1', true);

update public.invoices
set issued_at = created_at
where status = 'completed' and issued_at is null;

select set_config('app.issued_at_bypass', '', true);

alter table public.invoices
  add column if not exists ngay_chung_tu timestamptz
  generated always as (coalesce(issued_at, created_at)) stored;

comment on column public.invoices.ngay_chung_tu is
  '00335: NGÀY CHỨNG TỪ để hiển thị/lọc/sắp xếp = coalesce(issued_at, '
  'created_at). Cột SINH TỰ ĐỘNG, không ghi được. Hoá đơn đã phát hành lấy '
  'issued_at; nháp/đơn đặt chưa phát hành lấy created_at. Dùng cho màn danh '
  'sách hoá đơn (trộn nhiều trạng thái). Báo cáo doanh thu chỉ lấy completed '
  'nên dùng thẳng issued_at. Ca, sổ quỹ, kho, bếp vẫn dùng created_at.';

create index if not exists idx_invoices_tenant_ngay_chung_tu
  on public.invoices (tenant_id, ngay_chung_tu desc);

commit;

notify pgrst, 'reload schema';
