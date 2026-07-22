"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { mktGet, mktPost } from "@/lib/mkt/client";
import { useMktHref } from "@/components/mkt/mkt-routing";
import type { MktNotification } from "@/lib/mkt/read-models";

/** Bấm vào thông báo thì mở đúng chỗ (theo tham chiếu đã lưu). */
function targetHref(n: MktNotification): string | null {
  if (!n.referenceId) return null;
  switch (n.referenceType) {
    case "mkt_task":
      return `/tasks?task=${n.referenceId}`;
    case "mkt_channel_plan":
      return `/planning?plan=${n.referenceId}`;
    case "mkt_content_item":
      return `/approvals?content=${n.referenceId}`;
    default:
      return null;
  }
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

/**
 * Chuông thông báo MKT Hub. Chỉ hiện thông báo CỦA CHÍNH NGƯỜI ĐANG ĐĂNG NHẬP
 * (server lọc user_id + RLS) — không ai thấy thông báo của người khác.
 * Mobile: bảng thông báo trải NGANG MÀN HÌNH ngay dưới header, cuộn trong khung.
 * Desktop: thả xuống 380px canh phải.
 */
export function MktNotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<MktNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const toHref = useMktHref();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await mktGet<{ items: MktNotification[]; unread: number }>(
        "/api/mkt/v1/notifications",
      );
      setItems(r.items ?? []);
      setUnread(r.unread ?? 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Không tải được thông báo");
    } finally {
      setLoading(false);
    }
  }, []);

  // Nạp lúc vào Hub + tự làm mới mỗi phút (nhẹ, chỉ 1 truy vấn có index).
  // KHÔNG gọi API khi tab đang ẩn — tránh nện server suốt ngày với tab bỏ quên;
  // quay lại tab thì làm mới ngay để số chưa đọc không bị cũ.
  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Đóng khi bấm ra ngoài hoặc nhấn Esc.
  useEffect(() => {
    if (!open) return;
    // touchstart: trên điện thoại, chạm ra ngoài phải đóng ngay (không chỉ chuột).
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAll() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    try {
      await mktPost("/api/mkt/v1/notifications/read", {});
    } catch {
      void load();
    }
  }

  async function openItem(n: MktNotification) {
    if (!n.isRead) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      try {
        await mktPost("/api/mkt/v1/notifications/read", { ids: [n.id] });
      } catch {
        /* đã cập nhật trên màn hình; lần tải sau sẽ đồng bộ lại */
      }
    }
    const href = targetHref(n);
    setOpen(false);
    if (href) router.push(toHref(href));
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        aria-label={unread > 0 ? `Thông báo — ${unread} chưa đọc` : "Thông báo"}
        title="Thông báo"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-outline-variant bg-background hover:bg-surface-container"
      >
        <Icon name="notifications" size={18} />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className="fixed inset-x-2 top-16 z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-outline-variant bg-background shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[380px]"
          role="dialog"
          aria-label="Thông báo"
        >
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-3 py-2">
            <span className="text-sm font-semibold">Thông báo</span>
            <div className="flex items-center gap-1">
              {unread > 0 ? (
                <button
                  type="button"
                  onClick={markAll}
                  className="rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-surface-container"
                >
                  Đánh dấu đã đọc
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-surface-container"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {loading && items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-on-surface-variant">Đang tải…</p>
            ) : null}
            {err ? <p className="px-3 py-4 text-sm font-medium text-rose-600">{err}</p> : null}
            {!loading && !err && items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-on-surface-variant">
                Chưa có thông báo nào.
              </p>
            ) : null}

            {items.map((n) => {
              const clickable = Boolean(targetHref(n));
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => void openItem(n)}
                  className={
                    "flex w-full items-start gap-2.5 border-b border-outline-variant/60 px-3 py-3 text-left last:border-b-0 hover:bg-surface-container" +
                    (n.isRead ? "" : " bg-primary/5")
                  }
                >
                  <span
                    className={
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full " +
                      (n.isRead ? "bg-transparent" : "bg-primary")
                    }
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium leading-snug">{n.title}</span>
                    {n.description ? (
                      <span className="mt-0.5 line-clamp-2 block break-words text-xs text-on-surface-variant">
                        {n.description}
                      </span>
                    ) : null}
                    <span className="mt-1 block text-[11px] text-on-surface-variant">
                      {timeAgo(n.createdAt)}
                      {clickable ? " · Bấm để mở" : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
