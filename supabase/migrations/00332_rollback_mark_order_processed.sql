-- ============================================================================
-- ROLLBACK 00332 — gỡ RPC hoàn tất/mở lại xử lý đơn đặt hàng
-- Không đụng dữ liệu: các fulfilled_by_id đã gắn giữ nguyên (cơ chế 00188 cũ).
-- ============================================================================
drop function if exists public.mark_order_processed(uuid, uuid);
do $$ begin raise notice 'Rollback 00332: da go RPC, du lieu giu nguyen'; end $$;
