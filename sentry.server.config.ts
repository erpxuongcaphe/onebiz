// ────────────────────────────────────────────────────────────────────────
// Sentry — Server-side error tracking (Next.js server runtime)
// ────────────────────────────────────────────────────────────────────────
// Sprint LT-2 (CEO 04/05/2026).
//
// Server errors gồm: API route errors, getServerSideProps errors, RPC
// failures khi Next.js fetch từ Supabase. KHÔNG include client-side
// (xem sentry.client.config.ts).

import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "production",
    tracesSampleRate: 0.1,
  });
}
