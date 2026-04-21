"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
} from "@/components/ui/card";
import { LogoWordmark } from "@/components/brand/logo";
import { Icon } from "@/components/ui/icon";

/**
 * Đăng ký chủ tiệm (owner signup).
 *
 * Trigger handle_new_user (migration 00003) sẽ tự động:
 *   1. Tạo tenant mới với tên cửa hàng nhập trong form
 *   2. Tạo chi nhánh mặc định
 *   3. Tạo profile với role="owner"
 *   4. Tạo code_sequences mặc định (SP, KH, HD, ...)
 *
 * Để tránh ai cũng đăng ký được:
 *   - Chỉ dùng 1 lần để tạo admin đầu tiên
 *   - Sau đó TẮT email signup trong Supabase Dashboard > Auth > Providers
 *   - Staff sau này chỉ có thể tham gia qua lời mời từ trang he-thong/users
 */
export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Mật khẩu phải có ít nhất 6 ký tự");
      return;
    }
    if (password !== confirmPassword) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          store_name: storeName.trim() || `Cửa hàng của ${fullName.trim()}`,
        },
      },
    });

    if (signupError) {
      setError(signupError.message);
      setLoading(false);
      return;
    }

    // Nếu email confirmation enabled → cần confirm trước khi dùng được
    if (data.user && !data.session) {
      setSuccess(true);
      setLoading(false);
      return;
    }

    // Đã tự động đăng nhập (email confirmation disabled)
    router.push("/");
  }

  if (success) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3">
            <LogoWordmark height={32} />
          </div>
          <div className="mx-auto h-16 w-16 rounded-full bg-status-success/10 flex items-center justify-center mb-2">
            <Icon name="mark_email_read" size={32} className="text-status-success" />
          </div>
          <CardDescription className="text-base">
            Đã gửi email xác nhận đến <strong>{email}</strong>. Vui lòng click
            link trong email để kích hoạt tài khoản.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dang-nhap">
            <Button variant="outline" className="w-full">
              Về trang đăng nhập
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3">
          <LogoWordmark height={32} />
        </div>
        <CardDescription>Đăng ký chủ cửa hàng mới</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="fullName">Họ và tên *</Label>
            <Input
              id="fullName"
              placeholder="Nguyễn Văn A"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="storeName">Tên cửa hàng</Label>
            <Input
              id="storeName"
              placeholder="Cà phê OneBiz"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              placeholder="email@congty.vn"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Mật khẩu *</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">Tối thiểu 6 ký tự</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Nhập lại mật khẩu *</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Đang tạo tài khoản..." : "Đăng ký"}
          </Button>

          <p className="text-center text-sm text-muted-foreground">
            Đã có tài khoản?{" "}
            <Link href="/dang-nhap" className="text-primary hover:underline">
              Đăng nhập
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
