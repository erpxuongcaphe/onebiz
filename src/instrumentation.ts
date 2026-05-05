// ────────────────────────────────────────────────────────────────────────
// Next.js instrumentation hook — load Sentry config phù hợp runtime.
// ────────────────────────────────────────────────────────────────────────
// Sprint LT-2 (CEO 04/05/2026).
//
// Next.js 15 conventions: file `instrumentation.ts` được Next.js auto-load
// 1 lần khi server start. Dùng để init monitoring (Sentry, OpenTelemetry,
// etc.) trước khi nhận request đầu tiên.
//
// 2 runtime tách biệt:
// - "nodejs": server (API routes, getServerSideProps)
// - "edge"  : middleware, edge route handlers

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Capture errors trong React Server Components
export const onRequestError = Sentry.captureRequestError;
