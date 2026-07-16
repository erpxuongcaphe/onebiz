import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSharedCookieDomain } from "./cookie-domain";

/**
 * Extract root domain for cross-subdomain cookie sharing.
 * onebiz.com.vn → .onebiz.com.vn (shared with fnb.onebiz.com.vn)
 * fnb.onebiz.com.vn → .onebiz.com.vn (cùng cookie domain)
 * localhost → undefined (browser default)
 */
function getCookieDomain(request: NextRequest): string | undefined {
  return getSharedCookieDomain(request.headers.get("host"));
}

// ────────────────────────────────────────────
// FnB Subdomain Detection
// ────────────────────────────────────────────

/**
 * Kiểm tra request có đến từ FnB subdomain không.
 * Hỗ trợ: fnb.onebiz.com.vn, fnb.localhost, fnb-xxx.vercel.app
 */
function isFnbSubdomain(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  return host.startsWith("fnb.") || host.startsWith("fnb-");
}

/**
 * Kiểm tra request có đến từ MKT Hub subdomain không.
 * Hỗ trợ: mkthub.onebiz.com.vn, mkthub.localhost, mkthub-xxx.vercel.app.
 */
function isMktSubdomain(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  return host.startsWith("mkthub.") || host.startsWith("mkthub-");
}

function getFnbPublicPath(pathname: string): string {
  if (pathname === "/pos/fnb" || pathname === "/pos/fnb/") return "/";
  if (pathname.startsWith("/pos/fnb/")) {
    return pathname.replace("/pos/fnb", "") || "/";
  }
  if (pathname === "/" || pathname === "" || pathname.startsWith("/kds")) {
    return pathname || "/";
  }
  return "/";
}

function getFnbAuthRedirect(request: NextRequest): string {
  const redirect = request.nextUrl.searchParams.get("redirect");
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) {
    return "/";
  }
  return getFnbPublicPath(redirect);
}

function getMktPublicPath(pathname: string): string {
  if (pathname === "/mkt" || pathname === "/mkt/") return "/";
  if (pathname.startsWith("/mkt/")) {
    return pathname.replace("/mkt", "") || "/";
  }
  return pathname || "/";
}

function getMktAuthRedirect(request: NextRequest): string {
  const redirect = request.nextUrl.searchParams.get("redirect");
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) {
    return "/";
  }
  return getMktPublicPath(redirect);
}
/**
 * FnB subdomain routing:
 * - fnb.onebiz.com.vn/            → rewrite /pos/fnb
 * - fnb.onebiz.com.vn/kds         → rewrite /pos/fnb/kds
 * - fnb.onebiz.com.vn/dang-nhap   → allow (shared auth)
 * - fnb.onebiz.com.vn/pos/fnb/... → allow (direct links)
 * - fnb.onebiz.com.vn/anything    → redirect to /
 */
function handleFnbSubdomain(
  request: NextRequest,
  supabaseResponse: NextResponse,
  isAuthenticated: boolean,
): NextResponse {
  const { pathname } = request.nextUrl;

  // Public auth routes — always allow
  const publicPaths = ["/dang-nhap", "/quen-mat-khau", "/dat-lai-mat-khau"];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  // CEO 06/06/2026 REVERTED: clear cookies trong middleware quá aggressive.
  // Bug: race condition khi click navigation → middleware đọc cookie tạm
  // null → vào nhánh này (vô tình) → clear hết cookie → user logged-in bị đá.
  // Giữ fix client-side useEffect localStorage (chỉ chạy khi mount /dang-nhap).

  // Unauthenticated → login
  if (!isAuthenticated && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dang-nhap";
    url.searchParams.set("redirect", getFnbPublicPath(pathname));
    return NextResponse.redirect(url);
  }

  // Authenticated on auth page → redirect to the requested FnB screen.
  if (isAuthenticated && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = getFnbAuthRedirect(request);
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Auth pages pass through
  if (isPublicPath) return supabaseResponse;

  // ── FnB route rewrites ──
  // Root → FnB POS
  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/pos/fnb";
    const response = NextResponse.rewrite(url);
    copySetCookies(supabaseResponse, response);
    response.headers.set("x-fnb-subdomain", "1");
    return response;
  }

  // /kds → KDS
  if (pathname === "/kds" || pathname.startsWith("/kds/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/pos/fnb${pathname}`;
    const response = NextResponse.rewrite(url);
    copySetCookies(supabaseResponse, response);
    response.headers.set("x-fnb-subdomain", "1");
    return response;
  }

  // Allow direct /pos/fnb paths (internal navigation, Link components)
  if (pathname.startsWith("/pos/fnb")) {
    supabaseResponse.headers.set("x-fnb-subdomain", "1");
    return supabaseResponse;
  }

  // Allow API + static asset paths
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return supabaseResponse;
  }

  // Allow manifest + service worker
  if (pathname === "/manifest-fnb.json" || pathname === "/sw-fnb.js") {
    return supabaseResponse;
  }

  // Block all other routes — redirect to FnB home
  const url = request.nextUrl.clone();
  url.pathname = "/";
  return NextResponse.redirect(url);
}


/**
 * MKT Hub subdomain routing:
 * - mkthub.onebiz.com.vn/          -> rewrite /mkt
 * - mkthub.onebiz.com.vn/tasks/... -> rewrite /mkt/tasks/...
 * - mkthub.onebiz.com.vn/dang-nhap -> allow shared auth
 * - /api, /_next and assets pass through.
 */
function handleMktSubdomain(
  request: NextRequest,
  supabaseResponse: NextResponse,
  isAuthenticated: boolean,
): NextResponse {
  const { pathname } = request.nextUrl;

  const publicPaths = ["/dang-nhap", "/quen-mat-khau", "/dat-lai-mat-khau"];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  if (!isAuthenticated && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dang-nhap";
    url.searchParams.set("redirect", getMktPublicPath(pathname));
    return NextResponse.redirect(url);
  }

  if (isAuthenticated && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = getMktAuthRedirect(request);
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isPublicPath) return supabaseResponse;

  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return supabaseResponse;
  }

  if (pathname === "/manifest.json" || pathname === "/sw.js") {
    return supabaseResponse;
  }

  if (pathname === "/" || pathname === "") {
    const url = request.nextUrl.clone();
    url.pathname = "/mkt";
    const response = NextResponse.rewrite(url);
    copySetCookies(supabaseResponse, response);
    response.headers.set("x-mkt-subdomain", "1");
    return response;
  }

  // CEO 11/07: URL trên subdomain phải SẠCH — không lộ /mkt.
  // Link nội bộ trỏ /mkt/... → redirect về path bỏ prefix (giữ nguyên query),
  // request mới rơi vào nhánh rewrite bên dưới. mkthub.x/mkt/tasks → mkthub.x/tasks.
  if (pathname === "/mkt" || pathname === "/mkt/") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, 308);
  }
  if (pathname.startsWith("/mkt/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice("/mkt".length) || "/";
    return NextResponse.redirect(url, 308);
  }

  const url = request.nextUrl.clone();
  url.pathname = `/mkt${pathname}`;
  const response = NextResponse.rewrite(url);
  copySetCookies(supabaseResponse, response);
  response.headers.set("x-mkt-subdomain", "1");
  return response;
}
/** Copy set-cookie headers from Supabase auth response to rewrite response */
function copySetCookies(from: NextResponse, to: NextResponse): void {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value);
  });
}

// ────────────────────────────────────────────
// Main Middleware
// ────────────────────────────────────────────

/**
 * Refresh session token trên mỗi request.
 * Gọi từ src/proxy.ts.
 */
export async function updateSession(request: NextRequest) {
  // DEV-only auth bypass. Gate kép để production TUYỆT ĐỐI không bypass:
  //   1. NODE_ENV phải khác "production" (Vercel + Next build prod sẽ là "production")
  //   2. BYPASS_AUTH phải === "true" (set trong .env.local)
  //
  // Sprint A.3 (CEO 12/05): đổi NEXT_PUBLIC_BYPASS_AUTH → BYPASS_AUTH
  // để biến KHÔNG bị inline vào client bundle. Middleware chạy server-side
  // nên process.env.BYPASS_AUTH vẫn đọc được bình thường.
  const DEMO_MODE =
    process.env.NODE_ENV !== "production" &&
    process.env.BYPASS_AUTH === "true";
  if (DEMO_MODE) {
    // Vẫn xử lý FnB subdomain routing
    if (isFnbSubdomain(request)) {
      const { pathname } = request.nextUrl;
      if (pathname === "/" || pathname === "") {
        const url = request.nextUrl.clone();
        url.pathname = "/pos/fnb";
        return NextResponse.rewrite(url);
      }
      if (pathname === "/kds" || pathname.startsWith("/kds/")) {
        const url = request.nextUrl.clone();
        url.pathname = `/pos/fnb${pathname}`;
        return NextResponse.rewrite(url);
      }
    }
    if (isMktSubdomain(request)) {
      const { pathname } = request.nextUrl;
      if (pathname === "/" || pathname === "") {
        const url = request.nextUrl.clone();
        url.pathname = "/mkt";
        return NextResponse.rewrite(url);
      }
      // URL sạch như production: /mkt/... → redirect bỏ prefix
      if (pathname === "/mkt" || pathname === "/mkt/") {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url, 308);
      }
      if (pathname.startsWith("/mkt/")) {
        const url = request.nextUrl.clone();
        url.pathname = pathname.slice("/mkt".length) || "/";
        return NextResponse.redirect(url, 308);
      }
      if (!pathname.startsWith("/api")) {
        const url = request.nextUrl.clone();
        url.pathname = `/mkt${pathname}`;
        return NextResponse.rewrite(url);
      }
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  // Cross-subdomain cookie domain (e.g. .onebiz.com.vn)
  const cookieDomain = getCookieDomain(request);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Set cookie domain for cross-subdomain sharing
              // onebiz.com.vn ↔ fnb.onebiz.com.vn share session (.onebiz.com.vn cookie)
              ...(cookieDomain ? { domain: cookieDomain } : {}),
            })
          );
        },
      },
    }
  );

  // Verify the signed access token and refresh cookies when needed. getClaims()
  // avoids the Auth network roundtrip that getUser() performs on every page request.
  const { data: claimsData } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claimsData?.claims.sub);

  // ── FnB subdomain routing ──
  if (isFnbSubdomain(request)) {
    return handleFnbSubdomain(request, supabaseResponse, isAuthenticated);
  }

  // ── MKT Hub subdomain routing ──
  if (isMktSubdomain(request)) {
    return handleMktSubdomain(request, supabaseResponse, isAuthenticated);
  }

  // ── Standard ERP routing ──
  const publicPaths = ["/dang-nhap", "/quen-mat-khau", "/dat-lai-mat-khau"];
  const isPublicPath = publicPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  // Redirect unauthenticated users to login
  if (!isAuthenticated && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dang-nhap";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // CEO 06/06/2026 REVERTED: clear cookies trong middleware quá aggressive.
  // Bug: race condition khi click sidebar navigation → middleware đọc cookie
  // tạm null (Chrome chưa flush) → vào nhánh clear cookie → user bị đá ra.
  // Giữ fix client-side useEffect localStorage (chỉ chạy khi mount /dang-nhap).

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
