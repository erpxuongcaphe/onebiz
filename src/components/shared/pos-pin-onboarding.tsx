"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { Button } from "@/components/ui/button";
import { MyPosPin, readMyPinStatus } from "./my-pos-pin";

export function PosPinOnboarding({ children }: { children: ReactNode }) {
  const { user, isLoading, hasPermission, logout } = useAuth();
  const pathname = usePathname();
  const publicPage = /^\/(dang-nhap|quen-mat-khau|dat-lai-mat-khau|auth)(\/|$)/.test(pathname);
  const needsCheck = !publicPage && Boolean(user) && (hasPermission(PERMISSIONS.POS_FNB_SEND_KITCHEN) || hasPermission(PERMISSIONS.POS_RETAIL_CHECKOUT));
  const [state, setState] = useState<{ userId: string; hasPin?: boolean; error?: string } | null>(null);
  const check = useCallback(async () => {
    if (!needsCheck || !user) return;
    try {
      const status = await readMyPinStatus();
      if (status.userId !== user.id) throw new Error("Phiên tài khoản vừa thay đổi. Vui lòng đăng nhập lại.");
      setState(status);
    } catch (e) { setState({ userId: user.id, error: e instanceof Error ? e.message : "Chưa kiểm tra được PIN." }); }
  }, [needsCheck, user]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!needsCheck || !user) return;
      try { const status = await readMyPinStatus(); if (active && status.userId === user.id) setState(status); }
      catch (e) { if (active) setState({ userId: user.id, error: e instanceof Error ? e.message : "Chưa kiểm tra được PIN." }); }
    };
    void load();
    window.addEventListener("onebiz:pin-updated", load);
    // Recheck on return from another device or after a manager resets a PIN.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.removeEventListener("onebiz:pin-updated", load); document.removeEventListener("visibilitychange", onVisible); };
  }, [needsCheck, user]);
  const ready = !needsCheck || isLoading || (state?.userId === user?.id && state?.hasPin === true);
  // Keep the application mounted when a manager resets a PIN while a cart is
  // open. Hide/inert the page until setup completes, without discarding drafts.
  return <><div className={ready ? "contents" : "hidden"} hidden={!ready} inert={!ready}>{children}</div>{!ready && <main className="min-h-dvh bg-surface-container-low flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border bg-surface-container-lowest p-5 space-y-4">
    <h1 className="text-xl font-bold text-primary">Tạo PIN cá nhân</h1>
    {!state || state.userId !== user?.id ? <p role="status">Đang kiểm tra tài khoản…</p> : state.error ? <><p role="alert" className="text-status-error">{state.error}</p><Button onClick={() => void check()}>Thử lại</Button></> : <MyPosPin key={user?.id} hasPin={false} onSaved={() => void check()} />}
    <p className="text-sm text-muted-foreground">Sau khi lưu sẽ quay lại đúng màn đang mở. Trên máy dùng chung, chỉ tạo PIN cho tài khoản của mình.</p>
    <Button variant="ghost" onClick={() => void logout()}>Đăng xuất / đổi tài khoản</Button>
  </div></main>}</>;
}
