// ────────────────────────────────────────────────────────────────────────
// Sentry — Client-side error tracking (Next.js 15 + @sentry/nextjs v10)
// ────────────────────────────────────────────────────────────────────────
//
// Sprint LT-2 (CEO 04/05/2026).
//
// Convention v10: file PHẢI tên `instrumentation-client.ts` ở src/ hoặc
// root để Next.js + Sentry auto-pickup. File `sentry.client.config.ts`
// (legacy) không còn được auto-load trong v10.
//
// Sentry chỉ enable ở PRODUCTION. Dev mode bật → ô nhiễm dashboard với
// HMR errors / hot-reload edge cases.
//
// Sample rates (free tier 5k events/tháng):
// - tracesSampleRate: 0.1 → 10% transactions tracked
// - replaysSessionSampleRate: 0.1 → 10% sessions ghi replay
// - replaysOnErrorSampleRate: 1.0 → 100% sessions có error → xem replay
//
// DSN: env var NEXT_PUBLIC_SENTRY_DSN. Nếu thiếu → Sentry no-op (an toàn).

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
      // CEO 23/05/2026: @supabase/auth-js lock contention khi user mở
      // nhiều tab cùng app. Transient, không break UX — chỉ noise Sentry.
      // Đã có cached client + processLock ở src/lib/supabase/client.ts,
      // nhưng cross-tab vẫn race vì localStorage shared.
      "Acquiring process lock",
      /lock:sb-.*-auth-token/,
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

// Required by Sentry v10 — captures router transitions for performance
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
