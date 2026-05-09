"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoIcon, LogoWordmark } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icon";

const CURRENT_YEAR = new Date().getFullYear();
const OPERATION_AREAS = [
  { icon: "inventory_2", label: "Kho", value: "Tồn kho" },
  { icon: "point_of_sale", label: "POS", value: "Bán hàng" },
  { icon: "restaurant", label: "FnB", value: "Quầy & bếp" },
  { icon: "analytics", label: "Báo cáo", value: "Theo dõi" },
];

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-background p-6">
          <div className="h-10 w-48 animate-pulse rounded-lg bg-surface-container" />
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function getSafeRedirect(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const redirect = getSafeRedirect(searchParams.get("redirect"));
  const serverError = searchParams.get("error") ?? "";

  function handleSubmit() {
    setError("");
    setLoading(true);
  }

  return (
    <main className="relative isolate flex min-h-dvh overflow-hidden bg-background">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-90"
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,var(--surface-container-lowest)_0%,var(--surface-container-low)_42%,var(--primary-subtle)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(30,58,138,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(30,58,138,0.06)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_18%_18%,rgba(37,99,235,0.12),transparent_30%),radial-gradient(circle_at_82%_78%,rgba(22,163,74,0.10),transparent_28%)]" />
      </div>

      <section className="mx-auto grid min-h-dvh w-full min-w-0 max-w-7xl grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px]">
        <div className="hidden min-h-dvh flex-col justify-between px-10 py-8 lg:flex xl:px-14">
          <div className="flex items-center gap-3">
            <LogoIcon size={38} />
            <LogoWordmark height={25} />
          </div>

          <div className="max-w-xl">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-card/75 px-3 py-1 text-xs font-semibold text-primary shadow-sm backdrop-blur">
              <Icon name="verified_user" size={14} />
              Không gian làm việc nội bộ
            </p>
            <h1 className="font-heading text-4xl font-bold leading-tight tracking-normal text-foreground xl:text-5xl">
              Vào ca nhanh, quản trị gọn, dữ liệu liền mạch.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
              Một cổng đăng nhập cho cửa hàng, kho, POS Retail và FnB.
            </p>

            <div className="mt-8 grid max-w-lg grid-cols-2 gap-3">
              {OPERATION_AREAS.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-white/70 bg-card/80 p-4 shadow-sm backdrop-blur"
                >
                  <div className="mb-4 flex size-9 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                    <Icon name={item.icon} size={18} />
                  </div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="mt-1 font-heading text-lg font-bold text-foreground">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            ONEBIZ. ERP Suite · {CURRENT_YEAR}
          </p>
        </div>

        <div className="flex min-h-dvh w-full min-w-0 items-center justify-start px-4 py-8 sm:justify-center sm:px-6 lg:px-8">
          <section className="mx-auto w-[calc(100vw-2rem)] max-w-[340px] rounded-lg border border-white/70 bg-card/95 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur sm:w-full sm:max-w-[420px] md:p-7">
            <div className="mb-7 text-center">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm lg:hidden">
                <LogoIcon size={36} />
              </div>
              <div className="mx-auto mb-4 hidden justify-center lg:flex">
                <LogoWordmark height={34} />
              </div>
              <h2 className="font-heading text-2xl font-bold text-foreground">
                Đăng nhập OneBiz
              </h2>
              <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                Tiếp tục vào hệ thống quản lý vận hành.
              </p>
            </div>

            <form
              action={`/api/auth/sign-in?redirect=${encodeURIComponent(redirect)}`}
              method="post"
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {(error || serverError) && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {error || serverError}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="identifier">
                  Email hoặc SĐT
                </label>
                <div className="relative">
                  <Icon
                    name="alternate_email"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="identifier"
                    name="identifier"
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    placeholder="email@congty.vn hoặc 0912345678"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="h-11 rounded-lg pl-10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="password">
                  Mật khẩu
                </label>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={18}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 rounded-lg pl-10"
                    required
                  />
                </div>
                <div className="flex justify-end">
                  <Link
                    href="/quen-mat-khau"
                    className="text-sm font-medium text-primary hover:text-primary-hover hover:underline"
                  >
                    Quên mật khẩu?
                  </Link>
                </div>
              </div>

              <Button
                type="submit"
                size="touch"
                className="w-full font-semibold shadow-sm"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Icon name="progress_activity" size={18} className="animate-spin" />
                    Đang đăng nhập
                  </>
                ) : (
                  <>
                    Đăng nhập
                    <Icon name="arrow_forward" size={18} />
                  </>
                )}
              </Button>

              <div className="rounded-lg bg-surface-container-low px-4 py-3 text-center text-sm text-muted-foreground">
                Liên hệ quản lý để được cấp tài khoản.
              </div>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
