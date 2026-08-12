"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  getAuthRequestErrorMessage,
  withAuthRequestTimeout,
} from "@/lib/auth/auth-request-timeout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Mật khẩu xác nhận không khớp");
      return;
    }

    setLoading(true);

    const supabase = createClient();
    try {
      const { error: authError } = await withAuthRequestTimeout(
        supabase.auth.updateUser({ password }),
      );

      if (authError) {
        setError("Không thể đặt lại mật khẩu. Link có thể đã hết hạn, vui lòng yêu cầu link mới.");
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/dang-nhap");
      }, 2000);
    } catch (requestError) {
      setError(getAuthRequestErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-8 sm:px-6">
      <Card className="w-full max-w-sm shadow-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-lg bg-primary">
            <span className="text-lg font-bold text-white">O</span>
          </div>
          <CardTitle className="text-2xl">Đặt lại mật khẩu</CardTitle>
          <CardDescription>Nhập mật khẩu mới cho tài khoản</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {success && (
              <div role="status" className="rounded-lg bg-status-success/10 p-3 text-sm text-status-success">
                Đặt lại mật khẩu thành công. Đang chuyển hướng...
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                Mật khẩu mới
              </label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={success}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="confirm-password">
                Xác nhận mật khẩu mới
              </label>
              <Input
                id="confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={success}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || success}
            >
              {loading ? "Đang xử lý..." : "Đặt lại mật khẩu"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
