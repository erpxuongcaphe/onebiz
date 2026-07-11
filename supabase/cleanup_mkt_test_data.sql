-- ============================================================
-- DỌN DỮ LIỆU THỬ NGHIỆM MKT HUB (sau UAT Chrome 11-12/07/2026)
--
-- Xoá VĨNH VIỄN 2 chiến dịch thử + toàn bộ dữ liệu con:
--   1. "Chạy thử toàn luồng (TEST)"  id 836bf425-c6fb-45d3-91c1-6c401a445be7
--      (Claude tạo khi UAT — 7 task, 2 nội dung, 2 gói kênh, 1 mục sẵn sàng)
--   2. "Test"                        id a6743584-ace6-4c60-b934-72917790485a
--      (chiến dịch thử lúc go-live — không có task nào)
--
-- KHÔNG đụng: audit_log (giữ làm vết lịch sử), tài khoản Telegram,
-- pillars, media thật. Media thử trên thư viện đã xoá qua web từ trước.
--
-- Cách chạy: Supabase SQL Editor -> dán nguyên file -> Run.
-- Kết quả cuối cùng phải là bảng đếm với tất cả các dòng = 0.
-- ============================================================

do $$
declare
  v_campaign_ids uuid[] := array[
    '836bf425-c6fb-45d3-91c1-6c401a445be7'::uuid,
    'a6743584-ace6-4c60-b934-72917790485a'::uuid
  ];
  v_content_ids uuid[];
  v_task_ids uuid[];
  n bigint;
begin
  select coalesce(array_agg(id), '{}') into v_content_ids
  from public.mkt_content_items where campaign_id = any(v_campaign_ids);

  select coalesce(array_agg(id), '{}') into v_task_ids
  from public.mkt_tasks where campaign_id = any(v_campaign_ids);

  -- Thông báo trong chuông + hàng đợi Telegram trỏ tới dữ liệu thử
  delete from public.notifications
  where reference_type in ('mkt_task', 'mkt_content_item', 'mkt_campaign')
    and reference_id = any(v_task_ids || v_content_ids || v_campaign_ids);
  get diagnostics n = row_count; raise notice 'notifications: % dòng', n;

  delete from public.mkt_outbox_events
  where reference_id = any(v_task_ids || v_content_ids || v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_outbox_events: % dòng', n;

  -- Dữ liệu con theo thứ tự khoá ngoại
  delete from public.mkt_content_reviews where content_item_id = any(v_content_ids);
  get diagnostics n = row_count; raise notice 'mkt_content_reviews: % dòng', n;

  delete from public.mkt_content_versions where content_item_id = any(v_content_ids);
  get diagnostics n = row_count; raise notice 'mkt_content_versions: % dòng', n;

  delete from public.mkt_tasks where campaign_id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_tasks: % dòng', n;

  delete from public.mkt_content_items where campaign_id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_content_items: % dòng', n;

  delete from public.mkt_channel_work_packages where campaign_id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_channel_work_packages: % dòng', n;

  delete from public.mkt_campaign_readiness_items where campaign_id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_campaign_readiness_items: % dòng', n;

  delete from public.mkt_media_assets where campaign_id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_media_assets: % dòng', n;

  delete from public.mkt_campaigns where id = any(v_campaign_ids);
  get diagnostics n = row_count; raise notice 'mkt_campaigns: % dòng', n;
end;
$$;

-- Kiểm chứng: mọi con số dưới đây phải bằng 0
select 'mkt_campaigns' as bang, count(*) as con_lai from public.mkt_campaigns
  where id in ('836bf425-c6fb-45d3-91c1-6c401a445be7', 'a6743584-ace6-4c60-b934-72917790485a')
union all
select 'mkt_tasks', count(*) from public.mkt_tasks
  where campaign_id in ('836bf425-c6fb-45d3-91c1-6c401a445be7', 'a6743584-ace6-4c60-b934-72917790485a')
union all
select 'mkt_channel_work_packages', count(*) from public.mkt_channel_work_packages
  where campaign_id in ('836bf425-c6fb-45d3-91c1-6c401a445be7', 'a6743584-ace6-4c60-b934-72917790485a')
union all
select 'mkt_content_items', count(*) from public.mkt_content_items
  where campaign_id in ('836bf425-c6fb-45d3-91c1-6c401a445be7', 'a6743584-ace6-4c60-b934-72917790485a')
union all
select 'mkt_campaign_readiness_items', count(*) from public.mkt_campaign_readiness_items
  where campaign_id in ('836bf425-c6fb-45d3-91c1-6c401a445be7', 'a6743584-ace6-4c60-b934-72917790485a');
