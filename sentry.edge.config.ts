// ────────────────────────────────────────────────────────────────────────
// Sentry — Edge runtime (middleware, edge route handlers)
// ────────────────────────────────────────────────────────────────────────
// Sprint LT-2 (CEO 04/05/2026).
//
// Edge runtime gồm: middleware.ts (auth + FnB subdomain rewrite),
// edge API routes. Nhẹ hơn server config — không có replay/profiling.

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    tracesSampleRate: 0.1,
  });
}
