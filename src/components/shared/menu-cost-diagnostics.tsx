import { formatNumber } from "@/lib/format";
import type { MenuCostIssue } from "@/lib/services/supabase/fnb-menu-estimates";
import { MENU_COST_ISSUES } from "@/lib/reports/menu-cost-diagnostics";

export function MenuCostDiagnostics({ issues }: { issues?: MenuCostIssue[] }) {
  if (!issues?.length) return null;
  return <details onClick={event => event.stopPropagation()} className="mt-1 text-left text-xs font-normal whitespace-normal">
    <summary className="cursor-pointer rounded px-1 py-1.5 text-amber-800 dark:text-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
      {issues.length} thành phần cần đối soát
    </summary>
    <ul className="mt-1 space-y-2 border-l-2 border-status-warning/40 pl-2">
      {issues.map((issue, index) => <li key={`${issue.componentId ?? "missing"}-${index}`} className="break-words">
        <span className="block font-medium">{issue.code ? `${issue.code} · ` : ""}{issue.name}</span>
        <span className="block text-amber-800 dark:text-amber-300">{MENU_COST_ISSUES[issue.reason].label}</span>
        {(issue.physicalQuantity !== null || issue.costedQuantity !== null) && <span className="block text-muted-foreground">
          Tồn: {issue.physicalQuantity === null ? "Chưa rõ" : formatNumber(issue.physicalQuantity)}{issue.unit ? ` ${issue.unit}` : ""}
          {" · Có giá vốn: "}{issue.costedQuantity === null ? "Chưa rõ" : formatNumber(issue.costedQuantity)}{issue.unit ? ` ${issue.unit}` : ""}
        </span>}
        <span className="block text-muted-foreground">{MENU_COST_ISSUES[issue.reason].action}</span>
      </li>)}
    </ul>
  </details>;
}
