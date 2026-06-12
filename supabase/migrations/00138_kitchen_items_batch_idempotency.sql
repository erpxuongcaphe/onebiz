-- ====================================================================
-- 00138 — Idempotency cho "Gửi thêm" món vào đơn bếp đã tồn tại
-- ====================================================================
-- CEO 12/06/2026 — P0-8 audit (BATCH 2)
--
-- VẤN ĐỀ TRƯỚC FIX:
-- Khi cashier ấn "Gửi bếp bổ sung" (kitchen_order đã tồn tại):
--   - Online: addItemsToOrder() INSERT items thẳng vào kitchen_order_items
--   - Offline: enqueue { action: "addItems", payload: { items } }
--     khi reconnect → sync-manager replay → có thể GỌI 2 LẦN nếu network glitch
--     hoặc user F5 trong lúc enqueue chưa drain → items DUPLICATE trong bếp.
--
-- CÁCH FIX:
-- Thêm cột batch_id (uuid) — UI generate 1 batch_id per click "Gửi thêm".
-- UNIQUE INDEX (kitchen_order_id, batch_id) — DB chặn insert lần 2.
-- Cột nullable + index partial WHERE batch_id IS NOT NULL → data cũ KHÔNG bị ảnh hưởng.
-- ====================================================================

alter table public.kitchen_order_items
  add column if not exists batch_id uuid;

comment on column public.kitchen_order_items.batch_id is
  'P0-8 idempotency: UUID generate khi cashier ấn "Gửi thêm" — cùng batch_id + cùng kitchen_order_id chỉ insert được 1 lần. NULL = data cũ trước fix.';

-- Unique partial index — chỉ áp với row có batch_id (không cản data cũ NULL)
create unique index if not exists uniq_kitchen_order_items_batch
  on public.kitchen_order_items(kitchen_order_id, batch_id)
  where batch_id is not null;

-- ====================================================================
-- Hoàn tất — code app sẽ:
-- 1. UI: crypto.randomUUID() per click → gán batch_id cho cả batch items
-- 2. Service: insert kèm batch_id, catch '23505' (unique violation) → coi như OK (dedupe thành công)
-- ====================================================================
