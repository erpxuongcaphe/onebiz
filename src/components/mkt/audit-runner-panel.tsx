"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AuditAiAccessManager } from "@/components/mkt/audit-ai-access-manager";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  MKT_AUDIT_SCENARIOS,
  type MktAuditResult,
  type MktAuditRun,
  type MktAuditSandboxState,
} from "@/lib/mkt/audit-runner";

const UI = {
  title: "Ki\u1ec3m tra quy t\u1eafc MKT Hub",
  subtitle: "Ch\u1ea1y c\u00e1c t\u00ecnh hu\u1ed1ng gi\u1ea3 l\u1eadp tr\u00ean m\u00f4i tr\u01b0\u1eddng t\u00e1ch bi\u1ec7t, ki\u1ec3m tra tr\u1ef1c ti\u1ebfp quy t\u1eafc ph\u00eda m\u00e1y ch\u1ee7.",
  sandbox: "M\u00f4i tr\u01b0\u1eddng: Audit Sandbox",
  setup: "Kh\u1edfi t\u1ea1o m\u00f4i tr\u01b0\u1eddng th\u1eed",
  runAll: "Ch\u1ea1y t\u1ea5t c\u1ea3",
  running: "\u0110ang ki\u1ec3m tra...",
  copy: "Sao ch\u00e9p k\u1ebft qu\u1ea3 JSON",
  copied: "\u0110\u00e3 sao ch\u00e9p",
  scenario: "T\u00ecnh hu\u1ed1ng",
  expected: "Mong \u0111\u1ee3i",
  actual: "Th\u1ef1c t\u1ebf",
  audit: "Nh\u1eadt k\u00fd",
  result: "K\u1ebft qu\u1ea3",
  duration: "Th\u1eddi gian",
  yes: "C\u00f3",
  no: "Kh\u00f4ng",
  empty: "\u2014",
  neverReal: "Kh\u00f4ng d\u00f9ng d\u1eef li\u1ec7u c\u00f4ng ty; kh\u00f4ng g\u1eedi Telegram ho\u1eb7c email.",
};

type ApiError = { error?: { message?: string } };

async function readResponse<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(data.error?.message ?? "Audit Runner request failed");
  return data;
}

export function AuditRunnerPanel() {
  const [sandbox, setSandbox] = useState<MktAuditSandboxState>({ ready: false });
  const [run, setRun] = useState<MktAuditRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningKey, setRunningKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [setupResponse, runResponse] = await Promise.all([
        fetch("/api/mkt/v1/audit-runner/setup", { cache: "no-store" }),
        fetch("/api/mkt/v1/audit-runner/runs", { cache: "no-store" }),
      ]);
      const setupData = await readResponse<{ ready: boolean; sandboxId?: string; sandboxTenantId?: string; actorCount?: number }>(setupResponse);
      const runData = await readResponse<{ run: MktAuditRun | null }>(runResponse);
      setSandbox(setupData);
      setRun(runData.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audit Runner load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(
    () => new Map((run?.results ?? []).map((item) => [item.scenarioKey, item] as const)),
    [run],
  );

  async function setup() {
    setRunningKey("setup");
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/setup", { method: "POST" });
      const data = await readResponse<MktAuditSandboxState>(response);
      setSandbox(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audit setup failed");
    } finally {
      setRunningKey(null);
    }
  }

  async function execute(scenarioKeys?: string[]) {
    setRunningKey(scenarioKeys?.[0] ?? "all");
    setError(null);
    try {
      const response = await fetch("/api/mkt/v1/audit-runner/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scenarioKeys ? { scenarioKeys } : {}),
      });
      const data = await readResponse<{ run: MktAuditRun }>(response);
      setRun(data.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Audit run failed");
    } finally {
      setRunningKey(null);
    }
  }

  async function copyResults() {
    if (!run) return;
    await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const busy = runningKey !== null;
  const summary = {
    pass: run?.results.filter((item) => item.result === "PASS").length ?? 0,
    fail: run?.results.filter((item) => item.result === "FAIL").length ?? 0,
    error: run?.results.filter((item) => item.result === "ERROR").length ?? 0,
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 border-b border-outline-variant pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold tracking-normal sm:text-3xl">{UI.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">{UI.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {sandbox.ready ? (
            <Button disabled={busy} onClick={() => execute()}>
              <Icon name={busy ? "progress_activity" : "play_arrow"} size={18} />
              {busy ? UI.running : UI.runAll}
            </Button>
          ) : (
            <Button disabled={busy || loading} onClick={setup}>
              <Icon name={busy ? "progress_activity" : "shield"} size={18} />
              {UI.setup}
            </Button>
          )}
          <Button variant="outline" disabled={!run || busy} onClick={copyResults}>
            <Icon name={copied ? "check" : "content_copy"} size={17} />
            {copied ? UI.copied : UI.copy}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
          <Icon name="verified_user" size={17} />
          {UI.sandbox}
        </span>
        <span className="text-xs text-emerald-800/80">{UI.neverReal}</span>
        {sandbox.sandboxTenantId ? (
          <code className="ml-auto text-xs text-emerald-900">{sandbox.sandboxTenantId}</code>
        ) : null}
      </div>

      <AuditAiAccessManager sandboxReady={sandbox.ready} />

      {error ? (
        <div className="border-y border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-3 border-y border-outline-variant bg-background">
        <Summary label="PASS" value={summary.pass} tone="text-emerald-700" />
        <Summary label="FAIL" value={summary.fail} tone="text-rose-700" />
        <Summary label="ERROR" value={summary.error} tone="text-amber-700" />
      </div>

      <div className="overflow-x-auto border-y border-outline-variant bg-background">
        <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
          <thead className="bg-surface-container text-xs uppercase text-on-surface-variant">
            <tr>
              <th className="w-[26%] px-3 py-2.5">{UI.scenario}</th>
              <th className="w-[20%] px-3 py-2.5">{UI.expected}</th>
              <th className="w-[29%] px-3 py-2.5">{UI.actual}</th>
              <th className="w-[9%] px-3 py-2.5">{UI.audit}</th>
              <th className="w-[9%] px-3 py-2.5">{UI.result}</th>
              <th className="w-[7%] px-3 py-2.5">{UI.duration}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {MKT_AUDIT_SCENARIOS.map((scenario) => {
              const item = byKey.get(scenario.key);
              const rowBusy = runningKey === scenario.key;
              return (
                <tr key={scenario.key} className="align-top hover:bg-surface-container-low">
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-50"
                        title={"Ch\u1ea1y " + scenario.key}
                        aria-label={"Ch\u1ea1y " + scenario.key}
                        disabled={!sandbox.ready || busy}
                        onClick={() => execute([scenario.key])}
                      >
                        <Icon name={rowBusy ? "progress_activity" : "play_arrow"} size={17} />
                      </button>
                      <div>
                        <div className="font-mono text-xs font-semibold text-primary">{scenario.key}</div>
                        <div className="mt-0.5 font-medium">{scenario.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-on-surface-variant">{scenario.expected}</td>
                  <td className="px-3 py-3 text-on-surface-variant">
                    {item?.actual ?? "\u2014"}
                    {item?.errorCode ? (
                      <code className="mt-1 block text-xs text-on-surface">{item.errorCode}</code>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {item ? (item.auditRecorded ? UI.yes : UI.no) : "\u2014"}
                  </td>
                  <td className="px-3 py-3"><ResultBadge item={item} /></td>
                  <td className="px-3 py-3 text-xs text-on-surface-variant">
                    {item?.durationMs != null ? item.durationMs + " ms" : "\u2014"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-baseline justify-center gap-2 px-3 py-3">
      <span className={"text-xl font-bold " + tone}>{value}</span>
      <span className="text-xs font-semibold text-on-surface-variant">{label}</span>
    </div>
  );
}

function ResultBadge({ item }: { item?: MktAuditResult }) {
  if (!item) return <span className="text-on-surface-variant">{UI.empty}</span>;
  const cls = item.result === "PASS"
    ? "bg-emerald-50 text-emerald-700"
    : item.result === "FAIL"
      ? "bg-rose-50 text-rose-700"
      : "bg-amber-50 text-amber-700";
  return (
    <span className={"inline-flex rounded-md px-2 py-1 text-xs font-bold " + cls}>
      {item.result}
    </span>
  );
}
