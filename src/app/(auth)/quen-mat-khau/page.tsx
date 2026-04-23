"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

/** Nhận diện input là SĐT (VN) hay email. */
function isPhoneNumber(input: string): boolean {
  const cleaned = input.replace(/[\s-]/g, "");
  if (/^0\d{9,10}$/.test(cleaned)) return true;
  if (/^(\+?84)\d{9,10}$/.test(cleaned)) return true;
  return false;
}

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const trimmed = identifier.trim();

    // Supabase reset chỉ nhận email → tra email từ SĐT nếu user nhập SĐT.
    let email = trimmed;
    if (isPhoneNumber(trimmed)) {
      const { data: foundEmail, error: rpcError } = await supabase.rpc(
        "get_email_by_phone",
        { p_phone: trimmed },
      );
      if (rpcError) {
        setError("Không tra được SĐT. Thử lại sau hoặc nhập email.");
        setLoading(false);
        return;
      }
      if (!foundEmail) {
        setError("Không tìm thấy tài khoản với SĐT này.");
        setLoading(false);
        return;
      }
      email = foundEmail as string;
    }

    const { error: authError } = await supabase.auth.resetPasswordForEmail(
      email,
      { redirectTo: window.location.origin + "/dat-lai-mat-khau" }
    );

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 w-12 h-12 bg-primary rounded-xl flex items-center justify-center">
          <span className="text-white font-bold text-lg">O</span>
        </div>
        <CardTitle className="text-2xl">Quên mật khẩu</CardTitle>
        <CardDescription>
          Nhập email hoặc SĐT để nhận link đặt lại mật khẩu
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-md bg-status-success/10 p-3 text-sm text-status-success">
              Đã gửi link đặt lại mật khẩu qua email
            </div>
          )}
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="identifier">
              Email hoặc SĐT
            </label>
            <Input
              id="identifier"
              type="text"
              placeholder="email@congty.vn hoặc 0912345678"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              disabled={success}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={loading || success}
          >
            {loading ? "Đang gửi..." : "Gửi link đặt lại mật khẩu"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            <Link href="/dang-nhap" className="text-primary hover:underline">
              Quay lại đăng nhập
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
