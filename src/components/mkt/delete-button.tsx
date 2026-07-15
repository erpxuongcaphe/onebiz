"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useMktHref } from "@/components/mkt/mkt-routing";
import { mktDelete } from "@/lib/mkt/client";

/**
 * Nút xoá dùng chung cho MKT Hub (khuôn theo DeleteContentButton).
 * Mọi xoá trong MKT đều là XOÁ MỀM — bản ghi chỉ ẩn đi, có audit, khôi phục được.
 *
 * - `label`: nhãn cho tooltip/aria (VD "Xoá công việc").
 * - `children`: có chữ → nút dạng chữ; không có → nút icon vuông.
 * - `redirectTo`: xoá xong nhảy trang khác (dùng khi xoá chính bản ghi đang mở,
 *   VD xoá chiến dịch thì phải rời trang chi tiết). Không có → refresh tại chỗ.
 */
export function MktDeleteButton({
  url,
  confirmMessage,
  label,
  errorFallback = "Không xoá được",
  redirectTo,
  children,
}: {
  url: string;
  confirmMessage: string;
  label: string;
  errorFallback?: string;
  redirectTo?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const toMktHref = useMktHref();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm(confirmMessage)) return;
    setLoading(true);
    setError(null);
    try {
      await mktDelete(url);
      if (redirectTo) {
        router.push(toMktHref(redirectTo));
        router.refresh();
      } else {
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : errorFallback);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {error ? (
        <span className="max-w-64 text-right text-xs font-medium text-rose-600">{error}</span>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        size={children ? "sm" : "icon-sm"}
        disabled={loading}
        onClick={remove}
        aria-label={label}
        title={label}
      >
        <Icon name={loading ? "progress_activity" : "delete"} size={16} />
        {children}
      </Button>
    </div>
  );
}
