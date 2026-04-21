"use client";

import { useEffect } from "react";
import { useToast } from "@/lib/contexts";

/**
 * Listens for `auth:session-expired` events from AuthContext and shows
 * a warning toast when session is forcibly terminated (token expired,
 * logout from another device, refresh token invalidated).
 *
 * Phải mount BÊN TRONG ToastProvider để dùng `useToast()`. AuthProvider
 * dispatch custom event thay vì gọi useToast() trực tiếp — vì provider
 * order (Auth > Toast) không cho phép ngược.
 */
export function AuthSessionToast() {
  const { toast } = useToast();

  useEffect(() => {
    const handler = () => {
      toast({
        title: "Phiên đăng nhập đã hết hạn",
        description:
          "Bạn đã bị đăng xuất. Vui lòng đăng nhập lại để tiếp tục làm việc.",
        variant: "warning",
        duration: 8000,
      });
    };
    window.addEventListener("auth:session-expired", handler);
    return () => window.removeEventListener("auth:session-expired", handler);
  }, [toast]);

  return null;
}
