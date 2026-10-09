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
  const userId = user?.id;
  const publicPage = /^\/(dang-nhap|quen-mat-khau|dat-lai-mat-khau|auth)(\/|$)/.test(pathname);
  const needsCheck = !publicPage && Boolean(user) && (hasPermission(PERMISSIONS.POS_FNB_SEND_KITCHEN) || hasPermission(PERMISSIONS.POS_RETAIL_CHECKOUT));
  const [state, setState] = useState<{ userId: string; hasPin?: boolean; error?: string } | null>(null);
  const check = useCallback(async () => {
    if (!needsCheck || !userId) return;
    try {
      const status = await readMyPinStatus();
      if (status.userId !== userId) throw new Error("Phiên tài khoản vừa thay đổi. Vui lòng đăng nhập lại.");
      setState(status);
    } catch (e) { setState({ userId, error: e instanceof Error ? e.message : "Chưa kiểm tra được PIN." }); }
  }, [needsCheck, userId]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!needsCheck || !userId) return;
      try {
        const status = await readMyPinStatus();
        if (active) setState(status.userId === userId ? status : { userId, error: "Phiên tài khoản vừa thay đổi. Vui lòng đăng nhập lại." });
      }
      catch (e) { if (active) setState({ userId, error: e instanceof Error ? e.message : "Chưa kiểm tra được PIN." }); }
    };
    void load();
    window.addEventListener("onebiz:pin-updated", load);
    // Recheck on return from another device or after a manager resets a PIN.
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; window.removeEventListener("onebiz:pin-updated", load); document.removeEventListener("visibilitychange", onVisible); };
  }, [needsCheck, userId]);
  const ready = !needsCheck || isLoading || (state?.userId === user?.id && state?.hasPin === true);
  const setupRequired = state?.userId === userId && state?.hasPin === false && !state.error;
  // Keep the application mounted when a manager resets a PIN while a cart is
  // open. Hide/inert the page until setup completes, without discarding drafts.
  return <><div className={ready ? "contents" : "hidden"} hidden={!ready} inert={!ready}>{children}</div>{!ready && <main className="min-h-dvh bg-surface-container-low flex items-center justify-center p-4"><div className="w-full max-w-md rounded-xl border bg-surface-container-lowest p-5 space-y-4">
    <h1 className="text-xl font-bold text-primary">{setupRequired ? "Tạo PIN cá nhân" : "Kiểm tra phiên làm việc"}</h1>
    {!state || state.userId !== user?.id ? <p role="status">Đang kiểm tra tài khoản…</p> : state.error ? <><p role="alert" className="text-status-error">{state.error}</p><Button onClick={() => void check()}>Thử lại</Button></> : <MyPosPin key={user?.id} hasPin={false} onSaved={() => void check()} />}
    {setupRequired && <p className="text-sm text-muted-foreground">Chỉ tạo khi tài khoản chưa có PIN hoặc PIN đã được đặt lại. Tải lại trang không yêu cầu nhập lại PIN. Sau khi lưu sẽ quay lại đúng màn đang mở.</p>}
    <Button variant="ghost" onClick={() => void logout()}>Đăng xuất / đổi tài khoản</Button>
  </div></main>}</>;
}
