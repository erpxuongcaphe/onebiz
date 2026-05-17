-- ============================================================
-- 00078: Drop push_subscriptions + notification_preferences (CEO 16/05/2026)
--
-- Sau khi review quy trình thực tế của OneBiz, CEO quyết định không cần
-- Web Push API. Lý do:
--   - Cashier đã chủ động gọi điện quản lý → quản lý cấp OTP đọc qua điện
--     thoại (an toàn hơn push lên màn hình khoá)
--   - In-app notification (bell badge) + Zalo nhóm nội bộ đủ cho 5 đơn vị
--   - Chain of command rõ: cashier → quản lý chi nhánh → cấp cao hơn
--
-- Migration này drop 2 bảng tạo ở 00077 — không drop bảng `notifications`
-- (bảng này có sẵn từ schema gốc + đang dùng cho bell badge + 2 cron).
-- ============================================================

drop table if exists public.notification_preferences cascade;
drop table if exists public.push_subscriptions cascade;

notify pgrst, 'reload schema';
