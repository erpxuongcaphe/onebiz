"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { withAuthRequestTimeout, getAuthRequestErrorMessage } from "@/lib/auth/auth-request-timeout";
export default function ChangeTemporaryPasswordPage() {
  const [password, setPassword] = useState(""); const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <main className="flex min-h-dvh items-center justify-center px-4 py-8"><form className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-5" onSubmit={async event => {
    event.preventDefault(); if (busy) return; setError("");
    if (password !== confirmation) { setError("Mật khẩu xác nhận không khớp."); return; }
    setBusy(true);
    try { const response = await withAuthRequestTimeout(fetch("/api/auth/change-temporary-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })); const result = await response.json(); if (!response.ok) { setError(result.message); return; } window.location.replace("/"); }
    catch (failure) { setError(getAuthRequestErrorMessage(failure)); } finally { setBusy(false); }
  }}><h1 className="text-xl font-semibold">Đổi mật khẩu tạm</h1><p className="text-sm text-muted-foreground">Chọn mật khẩu riêng để tiếp tục sử dụng tài khoản.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  <label className="block space-y-1 text-sm">Mật khẩu mới<Input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label><label className="block space-y-1 text-sm">Xác nhận mật khẩu<Input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label><Button className="min-h-11 w-full" disabled={busy} type="submit">{busy ? "Đang lưu…" : "Lưu mật khẩu mới"}</Button></form></main>;
}
