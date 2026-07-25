-- ============================================================
-- 00225 — Huỷ hoá đơn thì nhả phiên bán hàng (POS)
-- ============================================================
-- HIỆN TRẠNG: 27 hoá đơn đã huỷ vẫn giữ `client_session_id`. Phiên POS nào bị
-- một đơn đã huỷ giữ thì thu ngân mở POS ra là kẹt, phải F5 mới bán tiếp được.
-- Cùng gốc với sự cố 20/07 (00212) — lần đó mới vá nhánh xoá mềm, còn nhánh
-- HUỶ thì bỏ sót.
--
-- VÌ SAO DÙNG TRIGGER thay vì sửa từng hàm: có ÍT NHẤT ba đường lật trạng thái
-- sang 'cancelled' — service TS `cancelInvoice`, RPC huỷ Retail, RPC huỷ F&B —
-- và không gì bảo đảm mai không có đường thứ tư. Trigger chặn ở tầng bảng nên
-- mọi đường đều đi qua, kể cả sửa tay trên Dashboard.
--
-- AN TOÀN: chỉ ghi NULL vào đúng một cột đánh dấu phiên POS. Không đụng tiền,
-- kho, công nợ, trạng thái. Đơn đã huỷ thì phiên cũng không còn ý nghĩa.
-- ============================================================

create or replace function public.release_pos_session_on_cancel()
returns trigger
language plpgsql
as $$
begin
  -- Đơn chuyển sang huỷ (hoặc đang huỷ mà vẫn còn giữ phiên) → nhả phiên
  if new.status = 'cancelled' and new.client_session_id is not null then
    new.client_session_id := null;
  end if;
  return new;
end;
$$;

comment on function public.release_pos_session_on_cancel is
  'Huỷ hoá đơn thì nhả client_session_id để phiên POS không bị đơn đã huỷ giữ (00225).';

drop trigger if exists trg_release_pos_session_on_cancel on public.invoices;

create trigger trg_release_pos_session_on_cancel
  before update on public.invoices
  for each row
  when (new.status = 'cancelled' and new.client_session_id is not null)
  execute function public.release_pos_session_on_cancel();

-- ────────────────────────────────────────────────────────────
-- Dọn 27 đơn cũ đang giam phiên
-- ────────────────────────────────────────────────────────────
update public.invoices
set client_session_id = null
where status = 'cancelled'
  and client_session_id is not null;

-- ============================================================
-- VERIFY — chạy sau khi áp
-- ============================================================
-- 1) Không còn đơn huỷ nào giam phiên (phải ra 0):
-- select count(*) as con_giam_phien
-- from public.invoices
-- where status = 'cancelled' and client_session_id is not null;
--
-- 2) Trigger đã gắn (phải ra 1 dòng):
-- select tgname, tgenabled from pg_trigger
-- where tgrelid = 'public.invoices'::regclass
--   and tgname = 'trg_release_pos_session_on_cancel';
