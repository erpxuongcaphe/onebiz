"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/icon";
import {
  MKT_AUDIT_SCENARIOS,
  type MktAuditResult,
  type MktAuditRun,
  type MktAuditScenarioKey,
} from "@/lib/mkt/audit-runner";

const UI = {
  scenario: "Tình huống",
  expected: "Mong đợi",
  actual: "Thực tế",
  audit: "Nhật ký",
  result: "Kết quả",
  duration: "Thời gian",
  yes: "Có",
  no: "Không",
  empty: "—",
};

export function AuditRunnerResults({
  run,
  busy = false,
  canRunScenarios = false,
  onRunScenario,
}: {
  run: MktAuditRun | null;
  busy?: boolean;
  canRunScenarios?: boolean;
  onRunScenario?: (scenarioKey: MktAuditScenarioKey) => void;
}) {
  const byKey = useMemo(
    () => new Map((run?.results ?? []).map((item) => [item.scenarioKey, item] as const)),
    [run],
  );
  const summary = {
    pass: run?.results.filter((item) => item.result === "PASS").length ?? 0,
    fail: run?.results.filter((item) => item.result === "FAIL").length ?? 0,
    error: run?.results.filter((item) => item.result === "ERROR").length ?? 0,
  };

  return (
    <>
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
              return (
                <tr key={scenario.key} className="align-top hover:bg-surface-container-low">
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      {canRunScenarios && onRunScenario ? (
                        <button
                          type="button"
                          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-50"
                          title={`Chạy ${scenario.key}`}
                          aria-label={`Chạy ${scenario.key}`}
                          disabled={busy}
                          onClick={() => onRunScenario(scenario.key)}
                        >
                          <Icon name="play_arrow" size={17} />
                        </button>
                      ) : null}
                      <div>
                        <div className="font-mono text-xs font-semibold text-primary">
                          {scenario.key}
                        </div>
                        <div className="mt-0.5 font-medium">{scenario.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-on-surface-variant">{scenario.expected}</td>
                  <td className="px-3 py-3 text-on-surface-variant">
                    {item?.actual ?? UI.empty}
                    {item?.errorCode ? (
                      <code className="mt-1 block text-xs text-on-surface">{item.errorCode}</code>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    {item ? (item.auditRecorded ? UI.yes : UI.no) : UI.empty}
                  </td>
                  <td className="px-3 py-3"><ResultBadge item={item} /></td>
                  <td className="px-3 py-3 text-xs text-on-surface-variant">
                    {item?.durationMs != null ? `${item.durationMs} ms` : UI.empty}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-baseline justify-center gap-2 px-3 py-3">
      <span className={`text-xl font-bold ${tone}`}>{value}</span>
      <span className="text-xs font-semibold text-on-surface-variant">{label}</span>
    </div>
  );
}

function ResultBadge({ item }: { item?: MktAuditResult }) {
  if (!item) return <span className="text-on-surface-variant">{UI.empty}</span>;
  const className = item.result === "PASS"
    ? "bg-emerald-50 text-emerald-700"
    : item.result === "FAIL"
      ? "bg-rose-50 text-rose-700"
      : "bg-amber-50 text-amber-700";
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${className}`}>
      {item.result}
    </span>
  );
}