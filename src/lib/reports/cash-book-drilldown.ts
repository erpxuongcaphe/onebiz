import { financeReportRangeError } from "./finance-report-input";

type BranchPeriod = { branch: string; from: string; to: string };
type Drilldown = BranchPeriod & { type: "receipt" | "payment" };

export function readCashBranchPeriod(query: URLSearchParams): BranchPeriod | null {
  const branch = query.get("branch") ?? "";
  const from = query.get("from") ?? "";
  const to = query.get("to") ?? "";
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(branch)
    || financeReportRangeError(from, to)) return null;
  return { branch, from, to };
}

export function readCashBookDrilldown(query: URLSearchParams): Drilldown | null {
  const scope = readCashBranchPeriod(query);
  const type = query.get("type");
  return scope && (type === "receipt" || type === "payment") ? { ...scope, type } : null;
}

export function cashAccountBalancesHref(branch: string, range: { from: string; to: string }) {
  const query = new URLSearchParams({ drilldown: "cash-flow", branch, from: range.from, to: range.to });
  return readCashBranchPeriod(query) ? `/cai-dat/tai-khoan-tien?${query}` : null;
}

export function cashBookDrilldownHref(branch: string, range: { from: string; to: string }, month: string, type: Drilldown["type"]) {
  const match = /^T([1-9]|1[0-2])\/(\d{4})$/.exec(month);
  if (!match || financeReportRangeError(range.from, range.to)) return null;
  const start = `${match[2]}-${match[1].padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(Number(match[2]), Number(match[1]), 0)).toISOString().slice(0, 10);
  const from = start < range.from ? range.from : start;
  const to = end > range.to ? range.to : end;
  const query = new URLSearchParams({ drilldown: "cash-flow", branch, from, to, type });
  return readCashBookDrilldown(query) ? `/so-quy?${query}` : null;
}
