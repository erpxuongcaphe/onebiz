// ────────────────────────────────────────────────────────────────────────
// Sentry — Client-side error tracking (Sprint LT-2, CEO 04/05/2026)
// ────────────────────────────────────────────────────────────────────────
//
// Sentry chỉ enable ở PRODUCTION. Dev mode bật → ô nhiễm dashboard với
// HMR errors / hot-reload edge cases.
//
// Sample rates (free tier 5k events/tháng):
// - tracesSampleRate: 0.1 → 10% transactions tracked. Đủ để spot perf
//   issues mà không over quota. Có thể tăng nếu cần debug specific page.
// - replaysSessionSampleRate: 0.1 → 10% sessions ghi replay (xem lại user
//   action như video). Hữu ích khi cashier báo bug.
// - replaysOnErrorSampleRate: 1.0 → 100% sessions có error được ghi
//   replay → khi có lỗi, anh xem được user click gì trước khi crash.
//
// DSN: dùng env var NEXT_PUBLIC_SENTRY_DSN (anh add trong Vercel Dashboard).
// Nếu env var thiếu → Sentry no-op (an toàn, không crash app).

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",

    // Performance monitoring — 10% sample
    tracesSampleRate: 0.1,

    // Session replay — xem lại UI khi crash
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration({
        // Privacy: mask text input + user data trước khi gửi Sentry
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Tránh log noise — bỏ qua một số error phổ biến không actionable
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications",
      // Network errors thường do user mất mạng — không phải bug code
      "Failed to fetch",
      "NetworkError",
      "Load failed",
      // Browser extensions
      "Non-Error promise rejection captured",
    ],

    // Strip query params containing sensitive data
    beforeSend(event) {
      // Strip auth tokens, PIN từ URL
      if (event.request?.url) {
        try {
          const url = new URL(event.request.url);
          ["token", "pin", "password", "secret"].forEach((p) =>
            url.searchParams.delete(p),
          );
          event.request.url = url.toString();
        } catch {
          /* ignore */
        }
      }
      return event;
    },
  });
}
