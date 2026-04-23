"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
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

/**
 * Nhận diện input là SĐT (VN) hay email.
 * SĐT VN: bắt đầu 0, 10-11 số (0912345678) hoặc +84/84 prefix.
 */
function isPhoneNumber(input: string): boolean {
  const cleaned = input.replace(/[\s-]/g, "");
  // 0xxxxxxxxx (10 số) hoặc 0xxxxxxxxxx (11 số)
  if (/^0\d{9,10}$/.test(cleaned)) return true;
  // +84xxxxxxxxx hoặc 84xxxxxxxxx
  if (/^(\+?84)\d{9,10}$/.test(cleaned)) return true;
  return false;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState(""); // email HOẶC SĐT
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const trimmed = identifier.trim();

    // Nếu nhập SĐT → tra email tương ứng trong DB. Supabase auth chỉ nhận
    // email + password, nên phải lookup trước khi signIn.
    let email = trimmed;
    if (isPhoneNumber(trimmed)) {
      const { data: foundEmail, error: rpcError } = await supabase.rpc(
        "get_email_by_phone",
        { p_phone: trimmed },
      );
      if (rpcError) {
        setError("Không tra được SĐT. Thử lại sau hoặc đăng nhập bằng email.");
        setLoading(false);
        return;
      }
      if (!foundEmail) {
        setError("Không tìm thấy tài khoản với SĐT này. Liên hệ quản lý để kiểm tra.");
        setLoading(false);
        return;
      }
      email = foundEmail as string;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    const redirect = searchParams.get("redirect") || "/";
    router.push(redirect);
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
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="identifier">
              Email hoặc SĐT
            </label>
            <Input
              id="identifier"
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
