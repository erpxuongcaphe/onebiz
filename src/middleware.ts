import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * PERF F3: Match all routes except:
     * - _next/static, _next/image, favicon, sitemap, robots
     * - Public assets (svg, png, jpg, jpeg, gif, webp, ico, woff/woff2)
     * - api routes (auth check tự handle trong route handler nếu cần)
     * - manifest, sw.js, workbox-*, PWA assets
     *
     * Trước đây matcher gọi updateSession (auth.getUser HTTP roundtrip ~50-150ms)
     * cho cả manifest/sw.js/woff fonts → mỗi nav tăng TTFB không cần thiết.
     */
    "/((?!_next/static|_next/image|api/|favicon\\.ico|sitemap\\.xml|robots\\.txt|manifest\\.(?:json|webmanifest)|sw\\.js|workbox-.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|css|js)$).*)",
  ],
};
