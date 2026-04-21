import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Extract root domain for cross-subdomain cookie sharing.
 * app.onebiz.com.vn → .onebiz.com.vn (shared with fnb.onebiz.com.vn)
 * localhost → undefined (browser default)
 */
function getCookieDomain(request: NextRequest): string | undefined {
  const host = request.headers.get("host") ?? "";
  // Strip port
  const hostname = host.split(":")[0];
  // Only set domain for production (not localhost)
  if (hostname === "localhost" || hostname === "127.0.0.1") return undefined;
  const parts = hostname.split(".");
  // Country-code SLD: .com.vn, .org.vn, .net.vn → need last 3 parts
  const ccSlds = ["com.vn", "org.vn", "net.vn", "edu.vn", "gov.vn"];
  const tail2 = parts.slice(-2).join(".");
  if (ccSlds.includes(tail2) && parts.length >= 3) {
    // app.onebiz.com.vn → .onebiz.com.vn
    return `.${parts.slice(-3).join(".")}`;
  }
  // Standard TLD: app.example.com → .example.com
  if (parts.length >= 2) {
    return `.${parts.slice(-2).join(".")}`;
  }
  return undefined;
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
  user: unknown,
): NextResponse {
  const { pathname } = request.nextUrl;

  // Public auth routes — always allow
  const publicPaths = ["/dang-nhap", "/dang-ky", "/quen-mat-khau", "/dat-lai-mat-khau"];
  const isPublicPath = publicPaths.some((p) => pathname.startsWith(p));

  // Unauthenticated → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dang-nhap";
    url.searchParams.set("redirect", "/");
    return NextResponse.redirect(url);
  }

  // Authenticated on auth page → redirect to FnB home
  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
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
 * Gọi từ src/middleware.ts.
 */
export async function updateSession(request: NextRequest) {
  // DEV-only auth bypass. Gate kép để production TUYỆT ĐỐI không bypass:
  //   1. NODE_ENV phải khác "production" (Vercel + Next build prod sẽ là "production")
  //   2. NEXT_PUBLIC_BYPASS_AUTH phải === "true" (set trong .env.local)
  // Nếu quên xoá env var khi deploy → NODE_ENV guard vẫn chặn bypass.
  const DEMO_MODE =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_BYPASS_AUTH === "true";
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
              // app.onebiz.com.vn ↔ fnb.onebiz.com.vn share session
              ...(cookieDomain ? { domain: cookieDomain } : {}),
            })
          );
        },
      },
    }
  );

  // Refresh session - QUAN TRỌNG: không bỏ dòng này
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ── FnB subdomain routing ──
  if (isFnbSubdomain(request)) {
    return handleFnbSubdomain(request, supabaseResponse, user);
  }

  // ── Standard ERP routing ──
  const publicPaths = ["/dang-nhap", "/dang-ky", "/quen-mat-khau", "/dat-lai-mat-khau"];
  const isPublicPath = publicPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  // Redirect unauthenticated users to login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/dang-nhap";
    url.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
