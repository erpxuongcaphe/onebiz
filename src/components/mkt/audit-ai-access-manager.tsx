"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type AuditAccess = {
  id: string;
  active: boolean;
  expiresAt: string;
  maxRuns: number;
  usedRuns: number;
  remainingRuns: number;
  lastUsedAt: string | null;
  createdAt: string;
};

type AccessPayload = {
  success: boolean;
  access: AuditAccess | null;
  shareUrl?: string;
  error?: { message?: string };
};

async function readPayload(response: Response): Promise<AccessPayload> {
  const payload = (await response.json().catch(() => ({}))) as AccessPayload;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Không thể quản lý liên kết AI.");
  }
  return payload;
}

export function AuditAiAccessManager({ sandboxReady }: { sandboxReady: boolean }) {
  const [access, setAccess] = useState<AuditAccess | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresInHours, setExpiresInHours] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/ai-links", {
        cache: "no-store",
      });
      const payload = await readPayload(response);
      setAccess(payload.access);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể đọc liên kết AI.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createLink() {
    setSaving(true);
    setError(null);
    setShareUrl(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/ai-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expiresInHours }),
      });
      const payload = await readPayload(response);
      setAccess(payload.access);
      setShareUrl(payload.shareUrl ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể tạo liên kết AI.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeLink() {
    if (!access) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/ai-links", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessId: access.id }),
      });
      await readPayload(response);
      setAccess(null);
      setShareUrl(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể thu hồi liên kết AI.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="border-y border-outline-variant bg-background px-3 py-3" aria-labelledby="ai-access-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="link" size={18} className="text-primary" />
            <h2 id="ai-access-title" className="font-heading text-base font-bold">
              Liên kết kiểm tra dành cho AI CEO
            </h2>
          </div>
          <p className="mt-1 text-xs text-on-surface-variant">
            Không cần đăng nhập; chỉ chạy Audit Sandbox, tối đa 3 lượt và có thể thu hồi ngay.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-on-surface-variant" htmlFor="audit-link-expiry">
            Thời hạn
          </label>
          <select
            id="audit-link-expiry"
            className="h-9 rounded-md border border-outline-variant bg-background px-2 text-sm"
            value={expiresInHours}
            disabled={saving}
            onChange={(event) => setExpiresInHours(Number(event.target.value))}
          >
            <option value={1}>1 giờ</option>
            <option value={4}>4 giờ</option>
            <option value={24}>24 giờ</option>
          </select>
          <Button disabled={!sandboxReady || saving || loading} onClick={createLink}>
            <Icon name={saving ? "progress_activity" : "add_link"} size={18} />
            {access?.active ? "Tạo liên kết mới" : "Tạo liên kết cho AI"}
          </Button>
          {access?.active ? (
            <Button variant="outline" disabled={saving} onClick={revokeLink}>
              <Icon name="link_off" size={17} />
              Thu hồi
            </Button>
          ) : null}
        </div>
      </div>

      {access?.active ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-outline-variant pt-3 text-xs text-on-surface-variant">
          <span className="font-semibold text-emerald-700">Đang hoạt động</span>
          <span>Còn {access.remainingRuns}/{access.maxRuns} lượt</span>
          <span>Hết hạn {new Date(access.expiresAt).toLocaleString("vi-VN")}</span>
        </div>
      ) : null}

      {shareUrl ? (
        <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-outline-variant pt-3">
          <input
            aria-label="Liên kết Audit Runner dành cho AI"
            readOnly
            value={shareUrl}
            className="h-9 min-w-0 flex-1 rounded-md border border-outline-variant bg-surface-container-low px-3 font-mono text-xs"
          />
          <Button variant="outline" onClick={copyLink}>
            <Icon name={copied ? "check" : "content_copy"} size={17} />
            {copied ? "Đã sao chép" : "Sao chép"}
          </Button>
        </div>
      ) : null}

      {access?.active && !shareUrl ? (
        <p className="mt-2 text-xs text-amber-700">
          Vì bảo mật, địa chỉ đầy đủ chỉ hiện một lần khi tạo. Tạo liên kết mới nếu cần sao chép lại.
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs font-medium text-rose-700">{error}</p> : null}
    </section>
  );
}