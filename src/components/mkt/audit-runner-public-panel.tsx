"use client";

import { useCallback, useEffect, useState } from "react";
import { AuditRunnerResults } from "@/components/mkt/audit-runner-results";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { MktAuditRun } from "@/lib/mkt/audit-runner";

type AccessState = {
  expiresAt: string;
  maxRuns: number;
  usedRuns: number;
  remainingRuns: number;
};

type ApiPayload = {
  success: boolean;
  ready?: boolean;
  access?: AccessState;
  run?: MktAuditRun | null;
  error?: { code?: string; message?: string };
};

async function readPayload(response: Response): Promise<ApiPayload> {
  const payload = (await response.json().catch(() => ({}))) as ApiPayload;
  if (!response.ok || !payload.success) {
    throw new Error(payload.error?.message ?? "Không thể truy cập Audit Runner.");
  }
  return payload;
}

export function AuditRunnerPublicPanel({ token }: { token: string }) {
  const [access, setAccess] = useState<AccessState | null>(null);
  const [run, setRun] = useState<MktAuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/ai", {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await readPayload(response);
      setAccess(payload.access ?? null);
      setRun(payload.run ?? null);
    } catch (cause) {
      setAccess(null);
      setError(cause instanceof Error ? cause.message : "Liên kết không hợp lệ.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function execute(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/ai", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const payload = await readPayload(response);
      setAccess(payload.access ?? null);
      setRun(payload.run ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể chạy kiểm tra.");
      await load();
    } finally {
      setRunning(false);
    }
  }

  async function copyResults() {
    if (!run) return;
    await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const expired = !loading && !access;
  const canRun = !expired && (access?.remainingRuns ?? 1) > 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 border-b border-outline-variant pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase text-primary">ONEBIZ | MKT HUB</p>
          <h1 className="mt-1 font-heading text-2xl font-bold tracking-normal sm:text-3xl">
            Kiểm tra quy tắc dành cho AI CEO
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">
            Liên kết giới hạn chỉ chạy 10 tình huống định sẵn trên môi trường thử nghiệm.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <form method="post" action="/api/mkt/v1/audit-runner/ai" onSubmit={execute}>
            <input type="hidden" name="token" value={token} />
            <Button type="submit" disabled={running || !canRun}>
              <Icon name={running ? "progress_activity" : "play_arrow"} size={18} />
              {running ? "Đang kiểm tra..." : "Chạy tất cả"}
            </Button>
          </form>
          <Button variant="outline" disabled={!run || running} onClick={copyResults}>
            <Icon name={copied ? "check" : "content_copy"} size={17} />
            {copied ? "Đã sao chép" : "Sao chép JSON"}
          </Button>
        </div>
      </header>

      {access ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
            <Icon name="verified_user" size={17} />
            Môi trường: Audit Sandbox
          </span>
          <span className="text-xs text-emerald-800/80">
            Không truy cập dữ liệu công ty; không gửi Telegram hoặc email.
          </span>
          <span className="ml-auto text-xs font-medium text-emerald-900">
            Còn {access.remainingRuns}/{access.maxRuns} lượt · Hết hạn {new Date(access.expiresAt).toLocaleString("vi-VN")}
          </span>
        </div>
      ) : null}

      {loading ? (
        <div className="border-y border-outline-variant bg-background px-3 py-3 text-sm text-on-surface-variant">
          Đang xác thực liên kết...
        </div>
      ) : null}
      {error ? (
        <div className="border-y border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <AuditRunnerResults run={run} busy={running} />
    </div>
  );
}