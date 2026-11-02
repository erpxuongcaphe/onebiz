"use client";
import { PasswordRecoveryForm } from "@/components/auth/password-recovery-form";
export default function ResetPasswordPage() {
  return <main className="flex min-h-dvh items-center justify-center bg-surface-container-low px-4 py-8 sm:px-6"><section className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-5 shadow-sm"><div><h1 className="text-xl font-semibold">Đặt lại mật khẩu</h1><p className="mt-1 text-sm text-muted-foreground">Xác thực email, sau đó chọn mật khẩu mới.</p></div><PasswordRecoveryForm /></section></main>;
}
