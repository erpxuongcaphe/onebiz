"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// --- Types ---

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  toasts: Toast[];
  /** Show a toast notification */
  toast: (options: {
    title: string;
    description?: string;
    variant?: ToastVariant;
    duration?: number;
  }) => void;
  /** Remove a specific toast */
  dismiss: (id: string) => void;
  /** Remove all toasts */
  dismissAll: () => void;
}

// --- Context ---

const ToastContext = createContext<ToastContextValue | null>(null);

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  const showToast = useCallback(
    (options: {
      title: string;
      description?: string;
      variant?: ToastVariant;
      duration?: number;
    }) => {
      const id = `toast_${++toastCounter}`;
      const duration = options.duration ?? 4000;
      const newToast: Toast = {
        id,
        title: options.title,
        description: options.description,
        variant: options.variant ?? "default",
        duration,
      };

      // R-7 13/06/2026 audit lần 2: dedup + cap. Trước đây bấm action lỗi 5
      // lần → 5 toast đè nhau che cả nút Đóng. Dedup theo title (cùng title
      // = thay duration lùi lại) + cap 5 toast (drop oldest).
      setToasts((prev) => {
        const sameTitle = prev.findIndex(
          (t) => t.title === options.title && t.variant === newToast.variant,
        );
        let next = prev;
        if (sameTitle >= 0) {
          // Bỏ toast cũ cùng title → toast mới hiện cuối
          next = prev.filter((_, i) => i !== sameTitle);
        }
        next = [...next, newToast];
        // Cap 5 toast — drop oldest nếu vượt
        if (next.length > 5) next = next.slice(next.length - 5);
        return next;
      });

      // Auto-dismiss
      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }
    },
    []
  );

  return (
    <ToastContext.Provider
      value={{ toasts, toast: showToast, dismiss, dismissAll }}
    >
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
