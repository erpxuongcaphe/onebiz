import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/supabase/types";
import { getSharedCookieDomain } from "@/lib/supabase/cookie-domain";

function isPhoneNumber(input: string): boolean {
  const cleaned = input.replace(/[\s-]/g, "");
  if (/^0\d{9,10}$/.test(cleaned)) return true;
  if (/^(\+?84)\d{9,10}$/.test(cleaned)) return true;
  return false;
}

function getCookieDomain(request: NextRequest): string | undefined {
  return getSharedCookieDomain(request.headers.get("host"));
}

function getSafeRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function applyAuthCookies(
  response: NextResponse,
  cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>,
  cookieDomain: string | undefined,
) {
  cookiesToSet.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, {
      ...options,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    });
  });
}

function fail(
  request: NextRequest,
  message: string,
  status: number,
  wantsJson: boolean,
) {
  if (wantsJson) {
    return NextResponse.json({ error: message }, { status });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/dang-nhap";
  url.searchParams.set("error", message);
  url.searchParams.set(
    "redirect",
    getSafeRedirect(request.nextUrl.searchParams.get("redirect")),
  );
  return NextResponse.redirect(url, { status: 303 });
}

async function readCredentials(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as {
      identifier?: unknown;
      password?: unknown;
    } | null;
    return {
      wantsJson: true,
      identifier: typeof body?.identifier === "string" ? body.identifier : "",
      password: typeof body?.password === "string" ? body.password : "",
    };
  }

  const form = await request.formData();
  return {
    wantsJson: false,
    identifier: String(form.get("identifier") ?? ""),
    password: String(form.get("password") ?? ""),
  };
}

export async function POST(request: NextRequest) {
  const { wantsJson, identifier, password } = await readCredentials(request);
  const trimmedIdentifier = identifier.trim();
  const rawPassword = password;

  if (!trimmedIdentifier || !rawPassword) {
    return fail(request, "Vui lòng nhập email/SĐT và mật khẩu.", 400, wantsJson);
  }

  const cookieDomain = getCookieDomain(request);
  const authCookies: Array<{
    name: string;
    value: string;
    options: CookieOptions;
  }> = [];
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          authCookies.push(...cookiesToSet);
        },
      },
    },
  );

  let email = trimmedIdentifier;
  if (isPhoneNumber(trimmedIdentifier)) {
    const { data: foundEmail, error: rpcError } = await supabase.rpc(
      "get_email_by_phone",
      { p_phone: trimmedIdentifier },
    );

    if (rpcError) {
      return fail(
        request,
        "Không tra được SĐT. Thử lại sau hoặc đăng nhập bằng email.",
        400,
        wantsJson,
      );
    }
    if (!foundEmail) {
      return fail(
        request,
        "Không tìm thấy tài khoản với SĐT này. Liên hệ quản lý để kiểm tra.",
        404,
        wantsJson,
      );
    }
    email = foundEmail as string;
  }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email,
    password: rawPassword,
  });

  if (authError) {
    return fail(request, authError.message, 401, wantsJson);
  }

  if (wantsJson) {
    const response = NextResponse.json({ ok: true });
    applyAuthCookies(response, authCookies, cookieDomain);
    return response;
  }

  const redirectUrl = new URL(
    getSafeRedirect(request.nextUrl.searchParams.get("redirect")),
    request.url,
  );
  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  applyAuthCookies(response, authCookies, cookieDomain);
  return response;
}
