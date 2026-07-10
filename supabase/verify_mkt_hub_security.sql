-- ============================================================
-- VERIFY: Bảo mật MKT Hub sau migration 00168 (+ 00169)
-- Chạy trên STAGING (Supabase SQL Editor) SAU khi apply migration.
-- Mỗi phần trả 1 bảng kết quả có cột "pass" — tất cả phải TRUE.
-- Không thay đổi dữ liệu (toàn read-only + transaction rollback).
-- ============================================================

-- ------------------------------------------------------------
-- PHẦN A — Quyền EXECUTE: anon KHÔNG gọi được RPC; 2 helper nội bộ
--          KHÔNG cho cả authenticated.
-- Kỳ vọng: mọi dòng pass = true.
-- ------------------------------------------------------------
select
  'anon không execute RPC nghiệp vụ' as check_name,
  p.proname as fn,
  not has_function_privilege('anon', p.oid, 'execute') as pass
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'mkt_split_work_package','mkt_accept_task','mkt_reject_task','mkt_need_discussion_task',
    'mkt_start_task','mkt_mark_task_done','mkt_force_task_done','mkt_reassign_task',
    'mkt_cancel_task','mkt_submit_task_review','mkt_review_content','mkt_confirm_readiness_item',
    'mkt_change_campaign_status','mkt_get_leader_queue','get_mkt_campaign_readiness_score'
  )
order by p.proname;

-- 2 helper (audit/notification): thu hồi cả authenticated (chỉ definer nội bộ gọi)
select
  '2 helper nội bộ chặn authenticated + anon' as check_name,
  p.proname as fn,
  (not has_function_privilege('authenticated', p.oid, 'execute')
   and not has_function_privilege('anon', p.oid, 'execute')) as pass
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('mkt_record_audit','mkt_enqueue_notification')
order by p.proname;

-- authenticated VẪN gọi được RPC nghiệp vụ (không revoke nhầm)
select
  'authenticated execute được RPC nghiệp vụ' as check_name,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) as ok_count,
  count(*) as total,
  count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')) = count(*) as pass
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'mkt_split_work_package','mkt_accept_task','mkt_review_content',
    'mkt_change_campaign_status','mkt_get_leader_queue'
  );

-- Leader queue view: KHÔNG cho anon/authenticated SELECT trực tiếp (chỉ qua RPC)
select
  'leader_queue_view chặn SELECT trực tiếp' as check_name,
  not has_table_privilege('anon', 'public.mkt_leader_queue_view', 'select') as anon_blocked,
  not has_table_privilege('authenticated', 'public.mkt_leader_queue_view', 'select') as authed_blocked,
  (not has_table_privilege('anon', 'public.mkt_leader_queue_view', 'select')
   and not has_table_privilege('authenticated', 'public.mkt_leader_queue_view', 'select')) as pass;

-- ------------------------------------------------------------
-- PHẦN B — RLS đã bật + có policy siết trên mọi bảng mkt_.
-- ------------------------------------------------------------
select
  'RLS bật trên bảng mkt_' as check_name,
  c.relname as tbl,
  c.relrowsecurity as pass
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname like 'mkt\_%'
  and c.relkind = 'r'
order by c.relname;

-- Policy SELECT không còn dạng "tenant-wide trần" (phải chứa điều kiện vai trò)
select
  'policy có siết vai trò (không tenant-trần)' as check_name,
  tablename as tbl,
  policyname,
  (qual like '%mkt_is_lead%' or qual like '%assignee_id%' or qual like '%owner_id%'
   or qual like '%mkt_can_review%' or qual like '%user_id = auth.uid%'
   or qual like '%recipient_user_id%' or qual like '%mkt_matches_readiness_role%'
   or qual like '%submitted_by%' or qual like '%reviewer_id%'
   or qual like '%mkt.view%') as pass
from pg_policies
where schemaname = 'public' and tablename in (
  'mkt_campaigns','mkt_tasks','mkt_content_items','mkt_channel_work_packages',
  'mkt_campaign_readiness_items','mkt_content_versions','mkt_content_reviews'
)
order by tablename;

-- ------------------------------------------------------------
-- PHẦN C — Kịch bản RLS 2 user (mô phỏng JWT). CHẠY TỪNG BLOCK.
-- Thay <EXECUTOR_UUID>, <OTHER_UUID>, <TENANT_UUID> bằng UUID thật
-- (lấy từ profiles/mkt_tasks trên staging). Transaction rollback,
-- không đổi dữ liệu.
-- ------------------------------------------------------------
-- C1. Executor CHỈ thấy task mình là assignee/reviewer (không thấy của người khác)
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<EXECUTOR_UUID>","role":"authenticated"}';
--   -- Kỳ vọng: chỉ trả task có assignee_id/reviewer_id = EXECUTOR_UUID
--   select id, title, assignee_id, reviewer_id from public.mkt_tasks;
-- rollback;

-- C2. Executor KHÔNG gọi được helper nội bộ (ghi audit giả) → phải lỗi permission denied
-- begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<EXECUTOR_UUID>","role":"authenticated"}';
--   -- Kỳ vọng: ERROR permission denied for function mkt_record_audit
--   select public.mkt_record_audit('<TENANT_UUID>','<EXECUTOR_UUID>','fake','mkt_task',null,null,null);
-- rollback;

-- C3. Anon KHÔNG dò được readiness score
-- begin;
--   set local role anon;
--   -- Kỳ vọng: ERROR permission denied for function get_mkt_campaign_readiness_score
--   select public.get_mkt_campaign_readiness_score('<ANY_CAMPAIGN_UUID>');
-- rollback;
