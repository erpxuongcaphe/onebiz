"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { LogoWordmark } from "@/components/brand/logo";

export default function LoginPage() {
  return (
    <Suspense>
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
  const [identifier, setIdentifier] = useState(""); // email HOẶC SĐT
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
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        {/* Logo wordmark ONEBIZ. — brand navy + chấm xanh period */}
        <div className="mx-auto mb-3">
          <LogoWordmark height={32} />
        </div>
        <CardDescription>ERP Suite — Đăng nhập vào hệ thống quản lý</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          action={`/api/auth/sign-in?redirect=${encodeURIComponent(redirect)}`}
          method="post"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {(error || serverError) && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error || serverError}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="identifier">
              Email hoặc SĐT
            </label>
            <Input
              id="identifier"
              name="identifier"
              type="text"
              inputMode="text"
              autoComplete="username"
              placeholder="email@congty.vn hoặc 0912345678"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium" htmlFor="password">
                Mật khẩu
              </label>
              <Link
                href="/quen-mat-khau"
                className="text-sm text-muted-foreground hover:text-primary"
              >
                Quên mật khẩu?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Đang đăng nhập..." : "Đăng nhập"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Liên hệ chủ cửa hàng để được cấp tài khoản
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
