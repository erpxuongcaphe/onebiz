"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withAuthRequestTimeout, getAuthRequestErrorMessage } from "@/lib/auth/auth-request-timeout";

export default function ForgotPasswordPage() {
  const emailEnabled = process.env.NEXT_PUBLIC_ONEBIZ_EMAIL_RECOVERY_ENABLED === "true";
  const [method, setMethod] = useState<"email" | "manager">("email");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => { if (!remaining) return; const timer = setTimeout(() => setRemaining(value => Math.max(0, value - 1)), 1000); return () => clearTimeout(timer); }, [remaining]);
  return <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-8 sm:px-6"><section className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-5 shadow-sm">
    <div><h1 className="text-xl font-semibold">Quên mật khẩu</h1><p className="mt-1 text-sm text-muted-foreground">Chọn cách khôi phục tài khoản.</p></div>
    <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"><Button className="min-h-11" variant={method === "email" ? "default" : "ghost"} aria-pressed={method === "email"} onClick={() => setMethod("email")}>Có email</Button><Button className="min-h-11" variant={method === "manager" ? "default" : "ghost"} aria-pressed={method === "manager"} onClick={() => setMethod("manager")}>Chỉ có SĐT</Button></div>
    {method === "manager" ? <div className="space-y-3 text-sm"><p>Nhờ cửa hàng trưởng, trưởng bộ phận hoặc quản lý được phân quyền đặt lại mật khẩu.</p><ol className="list-decimal space-y-2 pl-5"><li>Quản lý đăng nhập tài khoản của mình.</li><li>Vào Cài đặt → Người dùng, tìm nhân viên và chọn Đặt lại mật khẩu.</li><li>Nhân viên nhận mật khẩu tạm qua kênh riêng và đổi khi đăng nhập.</li></ol><p className="text-xs text-muted-foreground">Quản lý chỉ thao tác với cấp dưới trong phạm vi được giao. Không gửi mã SMS cho tài khoản chỉ có số điện thoại.</p></div> : !emailEnabled ? <div className="space-y-3"><p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">Email khôi phục chưa được bật. Anh/chị có thể nhờ quản lý được phân quyền hỗ trợ đặt lại mật khẩu.</p><Button className="min-h-11 w-full" variant="outline" onClick={() => setMethod("manager")}>Xem cách nhờ quản lý</Button></div> : <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (busy || remaining) return;
      setBusy(true); setError(""); setMessage("");
      try {
        const response = await withAuthRequestTimeout(fetch("/api/auth/password-recovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }), cache: "no-store" }));
        const result = await response.json();
        if (!response.ok) { if (response.status === 429) setRemaining(60); throw new Error(result.message ?? "Chưa gửi được email."); }
        setMessage(result.message); setRemaining(60);
      } catch (failure) { setError(failure instanceof Error && failure.name !== "AuthRequestTimeoutError" ? failure.message : getAuthRequestErrorMessage(failure)); }
      finally { setBusy(false); }
    }}>
      {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
      {message && <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">{message}</p>}
      <label className="block space-y-1 text-sm">Email đã đăng ký<Input className="text-base sm:text-sm" type="email" required autoComplete="email" maxLength={254} value={email} disabled={busy} onChange={event => setEmail(event.target.value)} placeholder="ten@congty.vn" /></label>
      <Button type="submit" className="min-h-11 w-full" disabled={busy || remaining > 0}>{busy ? "Đang gửi…" : remaining ? `Gửi lại sau ${remaining}s` : message ? "Gửi lại email" : "Gửi email khôi phục"}</Button>
      {message && <Link href="/dat-lai-mat-khau" className="block py-2 text-center text-sm font-medium text-primary underline">Nhập mã từ email</Link>}
    </form>}
    <Link href="/dang-nhap" className="flex min-h-11 items-center justify-center py-2 text-sm text-primary underline">Về đăng nhập</Link>
  </section></main>;
}
