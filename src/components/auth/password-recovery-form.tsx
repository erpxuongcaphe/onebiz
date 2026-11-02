"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createRecoveryClient } from "@/lib/auth/recovery-client";
import { withAuthRequestTimeout, getAuthRequestErrorMessage } from "@/lib/auth/auth-request-timeout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordRecoveryForm() {
  const client = useRef<ReturnType<typeof createRecoveryClient> | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    const isolated = createRecoveryClient(); client.current = isolated;
    let active = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access = hash.get("access_token"), refresh = hash.get("refresh_token");
    // Consume only a recovery link. Other logged-in tabs are never used as proof.
    if (hash.has("access_token") || hash.has("error")) {
      window.history.replaceState(null, "", window.location.pathname);
      if (hash.get("type") !== "recovery" || !access || !refresh) {
        setError("Link không hợp lệ hoặc đã hết hạn. Yêu cầu email mới.");
      } else {
        setBusy(true);
        void withAuthRequestTimeout(isolated.auth.setSession({ access_token: access, refresh_token: refresh }))
          .then(({ error: failure }) => { if (active) { if (failure) setError("Link không hợp lệ hoặc đã hết hạn. Yêu cầu email mới."); else setReady(true); } })
          .catch(failure => { if (active) setError(getAuthRequestErrorMessage(failure)); })
          .finally(() => { if (active) setBusy(false); });
      }
    }
    return () => { active = false; isolated.auth.stopAutoRefresh(); client.current = null; };
  }, []);
  if (success) return <div className="space-y-4"><p role="status" className="text-sm">Đã đổi mật khẩu. Anh/chị có thể đăng nhập bằng mật khẩu mới. Phiên POS đang mở vẫn giữ tài khoản hiện tại.</p><Link href="/dang-nhap" className="text-sm font-medium text-primary underline">Về đăng nhập</Link></div>;
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault(); if (busy || !client.current) return;
    setError(""); setBusy(true);
    try {
      if (!ready) {
        const { error: failure } = await withAuthRequestTimeout(client.current.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: "recovery" }));
        if (failure) setError("Mã không đúng hoặc đã hết hạn. Kiểm tra email hoặc xin mã mới."); else setReady(true);
      } else {
        if (password.length < 8 || password !== confirmation) { setError("Mật khẩu cần ít nhất 8 ký tự và xác nhận phải khớp."); return; }
        const { error: failure } = await withAuthRequestTimeout(client.current.auth.updateUser({ password }));
        if (failure) setError("Chưa đổi được mật khẩu. Kiểm tra yêu cầu mật khẩu hoặc xin email khôi phục mới.");
        else { setSuccess(true); setPassword(""); setConfirmation(""); await client.current.auth.signOut({ scope: "local" }); }
      }
    } catch (failure) { setError(getAuthRequestErrorMessage(failure)); }
    finally { setBusy(false); }
  }}>
    {error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {!ready ? <><p className="text-sm text-muted-foreground">Mở liên kết trong email hoặc nhập mã khôi phục nếu email có mã.</p><label className="block space-y-1 text-sm">Email<Input type="email" required autoComplete="email" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label><label className="block space-y-1 text-sm">Mã khôi phục<Input inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={10} value={otp} disabled={busy} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} /></label></> : <><label className="block space-y-1 text-sm">Mật khẩu mới<Input type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label><label className="block space-y-1 text-sm">Xác nhận mật khẩu mới<Input type="password" required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label></>}
    <Button className="min-h-11 w-full" disabled={busy} type="submit">{busy ? "Đang xử lý…" : ready ? "Đặt lại mật khẩu" : "Xác nhận mã"}</Button>
    <Link href="/quen-mat-khau" className="block py-2 text-center text-sm text-primary underline">Yêu cầu email mới</Link>
  </form>;
}
