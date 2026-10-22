"use client";
import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/contexts";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { Button } from "@/components/ui/button";
import { MyPosPin } from "./my-pos-pin";
import { usePosPinStatus } from "@/lib/hooks/use-pos-pin-status";

export function PosPinOnboarding({ children }: { children: ReactNode }) {
  const { user, isLoading, hasPermission, logout } = useAuth();
  const pathname = usePathname();
  const userId = user?.id;
  const publicPage = /^\/(dang-nhap|quen-mat-khau|dat-lai-mat-khau|auth)(\/|$)/.test(pathname);
  const needsCheck = !publicPage && Boolean(user) && (hasPermission(PERMISSIONS.POS_FNB_SEND_KITCHEN) || hasPermission(PERMISSIONS.POS_RETAIL_CHECKOUT));
  const { state, check } = usePosPinStatus(needsCheck, userId);
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

