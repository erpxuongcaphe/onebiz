import { qualityPeriodKey } from "./quality-periods";
import { datePresets } from "./filters";

export const hubViews = ["overview", "work", "todo", "qc", "kpi", "settings"] as const;
export type HubView = typeof hubViews[number];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const month = /^\d{4}-(0[1-9]|1[0-2])$/;
const day = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const filterKeys = ["search", "state", "category", "priority", "frequency", "result", "assignee", "operator", "department", "preset", "from", "to", "dateField", "mine", "overdue", "offset", "mode"] as const;
export function readHubLocation(search: string, fallbackMonth: string) {
  const p = new URLSearchParams(search);
  const assessment = qualityPeriodKey.safeParse(p.get("assessment") ?? (p.get("period")?.startsWith("custom:") ? p.get("period") : null));
  return {
    view: hubViews.includes(p.get("view") as HubView) ? p.get("view") as HubView : "work" as HubView,
    branch: uuid.test(p.get("branch") ?? "") ? p.get("branch")! : "",
    period: month.test(p.get("period") ?? "") ? p.get("period")! : fallbackMonth,
    assessment: assessment.success ? assessment.data : "",
  };
}
export function readHubFilters(search: string) {
  const p = new URLSearchParams(search), result: Record<string,string> = {};
  for (const key of filterKeys) {
    const value = p.get(`f_${key}`) ?? (key === "search" ? p.get("search") : null);
    if (value === null) continue;
    if (["assignee", "operator", "department"].includes(key) && value && !uuid.test(value)) continue;
    if (["from", "to"].includes(key) && value && (!day.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) continue;
    if (key === "preset" && !(value in datePresets)) continue;
    if (key === "dateField" && !["due", "created", "completed", "checked"].includes(value)) continue;
    if (key === "offset" && (!/^\d+$/.test(value) || Number(value) > 100000 || Number(value) % 50 !== 0)) continue;
    if (["mine", "overdue"].includes(key) && !["true", "false"].includes(value)) continue;
    if (key === "mode" && !["scheduled", "adhoc"].includes(value)) continue;
    if (key === "result" && !["", "unknown", "met", "unmet"].includes(value)) continue;
    if (key === "frequency" && !["", "once", "daily", "weekly", "monthly", "quarterly", "yearly", "event"].includes(value)) continue;
    result[key] = value.slice(0, key === "search" ? 200 : 80);
  }
  return result;
}
// URL values select an existing server-authorized view; they never confer permissions.
export function writeHubLocation(patch: Record<string,string|null>, push = false, clearFilters = false) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  if (clearFilters) for (const key of [...p.keys()]) if (key.startsWith("f_") || ["audit", "task", "search"].includes(key)) p.delete(key);
  for (const [key,value] of Object.entries(patch)) { if (value === null || value === "") p.delete(key); else p.set(key,value); }
  const query = p.toString(), url = window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  window.history[push ? "pushState" : "replaceState"](window.history.state, "", url);
}
export function writeHubFilters(values: Record<string,string|number|boolean>) {
  writeHubLocation(Object.fromEntries(Object.entries(values).map(([key,value])=>[`f_${key}`,value === "" || value === false || value === 0 ? null : String(value)])));
}
