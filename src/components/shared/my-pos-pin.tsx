"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/contexts";
import { changeMyPosPin } from "@/lib/services/supabase/pos-pin";

export async function readMyPinStatus(): Promise<{ userId: string; hasPin: boolean }> {
  const response = await fetch("/api/auth/pos-pin", { cache: "no-store" });
  const body = await response.json();
  if (!response.ok || typeof body.hasPin !== "boolean" || typeof body.userId !== "string") throw new Error(body.message || "Chưa kiểm tra được PIN.");
  return body;
}

export function MyPosPin({ hasPin, onSaved }: { hasPin: boolean; onSaved: () => void }) {
  const { user } = useAuth();
  const [oldPin, setOldPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const actor = useRef(user?.id);
  actor.current = user?.id;
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    if (!/^\d{6}$/.test(pin) || pin !== confirm) { setError("Nhập PIN 6 chữ số và xác nhận trùng khớp."); return; }
    const startedBy = user?.id;
    lock.current = true; setSaving(true); setError("");
    try {
      const status = await readMyPinStatus();
      if (status.userId !== startedBy || actor.current !== startedBy) throw new Error("Tài khoản vừa thay đổi. Vui lòng mở lại PIN của mình.");
      if (forgot && status.hasPin) {
        const response = await fetch("/api/auth/pos-pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, pin }) });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.message || "Chưa đặt lại được PIN.");
      } else {
        await changeMyPosPin(pin, status.hasPin ? oldPin : null);
      }
      setPin(""); setConfirm(""); setOldPin(""); setPassword("");
      if (actor.current === startedBy) { window.dispatchEvent(new Event("onebiz:pin-updated")); onSaved(); }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Chưa lưu được PIN.";
      setError(message.includes("INVALID_OLD_PIN") ? "PIN hiện tại chưa đúng. Có thể chọn Quên PIN để xác minh bằng mật khẩu." : message.includes("PIN_SAME_AS_OLD") ? "PIN mới cần khác PIN hiện tại." : message.includes("OLD_PIN_REQUIRED") ? "Tài khoản đã có PIN. Hãy nhập PIN hiện tại." : message);
    } finally { lock.current = false; setSaving(false); }
  };
  const pinField = (label: string, value: string, update: (value: string) => void, id: string) => <div className="space-y-1.5"><label className="text-sm font-medium" htmlFor={id}>{label}</label><Input id={id} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={e => update(e.target.value.replace(/\D/g, "").slice(0, 6))} disabled={saving} className="h-12 text-lg tracking-widest" required /></div>;
  return <form onSubmit={save} className="space-y-4">
    <p className="text-sm">Tài khoản: <strong className="text-primary">{user?.fullName}</strong></p>
    <p className="text-sm text-muted-foreground">PIN cá nhân gồm 6 chữ số, dùng khi bàn giao POS. PIN không thay thế mã OTP duyệt thao tác.</p>
    {hasPin && !forgot && pinField("PIN hiện tại", oldPin, setOldPin, "my-old-pin")}
    {hasPin && forgot && <div className="space-y-1.5"><label htmlFor="pin-password" className="text-sm font-medium">Mật khẩu đăng nhập của mình</label><Input id="pin-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={saving} required className="h-12" /><p className="text-sm text-muted-foreground">Quên cả mật khẩu? Đăng nhập lại qua Quên mật khẩu, hoặc nhờ quản lý đặt lại PIN; sau đó tự tạo PIN mới bằng tài khoản của mình.</p></div>}
    {pinField("PIN mới (6 chữ số)", pin, setPin, "my-new-pin")}
    {pinField("Nhập lại PIN mới", confirm, setConfirm, "my-confirm-pin")}
    {error && <p role="alert" className="text-sm text-status-error">{error}</p>}
    <Button type="submit" disabled={saving || pin.length !== 6 || confirm !== pin || (hasPin && (forgot ? !password : oldPin.length !== 6))} className="h-12 w-full">{saving ? "Đang lưu…" : hasPin ? "Lưu PIN mới" : "Tạo PIN và tiếp tục"}</Button>
    {hasPin && <Button type="button" variant="ghost" disabled={saving} onClick={() => { setForgot(!forgot); setError(""); setPassword(""); setOldPin(""); }}>{forgot ? "Tôi nhớ PIN hiện tại" : "Quên PIN?"}</Button>}
  </form>;
}

export function MyPosPinSettings() {
  const { user } = useAuth();
  const [status, setStatus] = useState<{ userId: string; hasPin: boolean } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    // The profile renders after authentication loads, so native hash scrolling
    // can happen before this section exists. Scroll once its content is ready.
    if (status?.userId === user?.id && window.location.hash === "#pin-cua-toi") {
      document.getElementById("pin-cua-toi")?.scrollIntoView({ block: "start" });
    }
  }, [status?.userId, user?.id]);
  useEffect(() => {
    let active = true;
    readMyPinStatus().then(value => { if (active && value.userId === user?.id) { setStatus(value); setError(""); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user?.id, revision]);
  return <section id="pin-cua-toi" className="scroll-mt-6 rounded-lg border p-4 space-y-4"><h2 className="font-bold text-primary text-lg">PIN của tôi</h2>
    {saved && <p role="status" className="text-status-success">Đã lưu PIN cá nhân.</p>}
    {error ? <div><p role="alert">{error}</p><Button variant="outline" onClick={() => setRevision(v => v + 1)}>Thử lại</Button></div> : status && status.userId === user?.id ? <MyPosPin key={user?.id} hasPin={status.hasPin} onSaved={() => { setSaved(true); setRevision(v => v + 1); }} /> : <p>Đang kiểm tra PIN…</p>}
  </section>;
}
