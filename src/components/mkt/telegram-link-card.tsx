"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";

type LinkTokenResponse = {
  success: boolean;
  startPayload?: string;
  botUrl?: string | null;
  expiresAt?: string;
  error?: { message?: string };
};

export function TelegramLinkCard({
  linked,
  username,
}: {
  linked: boolean;
  username: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ botUrl: string | null; startPayload: string } | null>(
    null,
  );

  async function handleConnect() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mkt/v1/telegram/link-token", { method: "POST" });
      const data = (await res.json()) as LinkTokenResponse;
      if (!res.ok || !data.success || !data.startPayload) {
        setError(data.error?.message ?? "Không tạo được liên kết, thử lại sau");
        return;
      }
      setPayload({ botUrl: data.botUrl ?? null, startPayload: data.startPayload });
      if (data.botUrl) window.open(data.botUrl, "_blank", "noopener");
    } catch {
      setError("Lỗi kết nối, thử lại sau");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlink() {
    setLoading(true);
    setError(null);
    try {
      await fetch("/api/mkt/v1/telegram/unlink", { method: "POST" });
      router.refresh();
    } catch {
      setError("Không ngắt được liên kết, thử lại sau");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-outline-variant bg-background p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
          <Icon name="send" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-lg font-semibold">Kết nối Telegram</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Nhận thông báo giao việc, chờ duyệt và nhắc việc ngay trên Telegram, kèm liên kết mở
            đúng màn hình trên web.
          </p>

          {linked ? (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700">
                <Icon name="check_circle" size={16} />
                Đã liên kết{username ? ` (@${username})` : ""}
              </span>
              <button
                type="button"
                onClick={handleUnlink}
                disabled={loading}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-outline-variant bg-background px-3 text-sm font-medium hover:bg-surface-container disabled:opacity-50"
              >
                <Icon name="link_off" size={18} />
                Ngắt liên kết
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={handleConnect}
                disabled={loading}
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                <Icon name="send" size={18} />
                {loading ? "Đang tạo liên kết…" : "Kết nối Telegram"}
              </button>

              {payload ? (
                <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-sm">
                  {payload.botUrl ? (
                    <p>
                      Nếu Telegram chưa tự mở, bấm{" "}
                      <a
                        href={payload.botUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-primary underline"
                      >
                        vào đây
                      </a>{" "}
                      rồi nhấn <b>Start</b> trong bot.
                    </p>
                  ) : (
                    <p>
                      Mở bot Telegram của công ty và gửi lệnh sau (còn hiệu lực 15 phút):
                    </p>
                  )}
                  <code className="mt-2 block break-all rounded bg-surface-container px-2 py-1 font-mono text-xs">
                    /start {payload.startPayload}
                  </code>
                </div>
              ) : null}
            </div>
          )}

          {error ? <p className="mt-3 text-sm font-medium text-rose-600">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
