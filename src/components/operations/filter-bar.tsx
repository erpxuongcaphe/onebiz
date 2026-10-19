"use client";

import { Input } from "@/components/ui/input";
import { useId } from "react";
import { Icon } from "@/components/ui/icon";
import { formatShortDate } from "@/lib/format";
import { categories, priorities, states, type Person, type Standard } from "@/lib/operations/contracts";
import { datePresets, filterDates, initialFilters, type FilterKind, type OperationsFilters } from "@/lib/operations/filters";
import styles from "./workspace.module.css";
import { UserPicker } from "./user-picker";
import { frequencyLabels } from "@/lib/operations/recurrence";

export function OperationsFilterBar({ kind, value, onChange, people, standards = [], period, settingsTarget = "standards", standardCategories = {} }: {
  kind: FilterKind; value: OperationsFilters; onChange: (value: OperationsFilters) => void;
  people: Person[]; standards?: Standard[]; period: string; settingsTarget?: "standards" | "policies" | "members";
  standardCategories?: Record<string, string>;
}) {
  const id = useId();
  const set = (key: keyof OperationsFilters, selected: string) => onChange({ ...value, [key]: selected });
  const select = (key: keyof OperationsFilters, label: string, options: Record<string, string>, empty = "Tất cả") => <label className={styles.field} key={key} htmlFor={`${id}-${key}`}><span>{label}</span><select aria-label={label} id={`${id}-${key}`} value={value[key]} onChange={event => set(key, event.target.value)}>{key !== "dateField" && <option value="">{empty}</option>}{Object.entries(options).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
  let error = "";
  let calendar = "Tất cả thời gian";
  try { const range = filterDates(value, period); if (range.from) calendar = `${formatShortDate(range.from)} - ${formatShortDate(range.to)}`; } catch (cause) { error = (cause as Error).message; }
  const active = Object.entries(value).filter(([key, v]) => !["dateField", "preset", "from", "to"].includes(key) && !!v).length + (value.preset !== initialFilters(kind).preset ? 1 : 0);
  return <div className={styles.filters} aria-label="Bộ lọc công việc">
    <div className={styles.filterHeading}><strong><Icon name="filter_alt" size={17} /> Bộ lọc{active ? ` · ${active}` : ""}</strong><button type="button" onClick={() => onChange(initialFilters(kind))}><Icon name="filter_alt_off" size={16} /> Đặt lại</button></div>
    <div className={`${styles.filterGrid} ${kind !== "settings" && value.preset === "custom" ? styles.filterGridDates : ""}`}>
      {!(kind === "settings" && settingsTarget === "members") && select("state", "Trạng thái", kind === "settings" ? (settingsTarget === "standards" ? { draft: states.draft, pending: states.pending_approval, changes_requested: states.changes_requested, approved: states.approved, retired: states.retired } : { draft: states.draft, approved: states.approved }) : kind === "todo" ? { pending: states.pending, in_progress: states.in_progress, waiting: states.waiting, done: states.done, canceled: states.canceled } : { pending: states.pending, transferred: states.transferred, done: states.done })}
      {!(kind === "settings" && settingsTarget === "policies") && <UserPicker label={settingsTarget === "members" && kind === "settings" ? "Tài khoản" : "Người chịu trách nhiệm"} value={value.assignee} onChange={(id) => set("assignee",id)} options={people}/>}
      {!(kind === "settings" && settingsTarget === "members") && <>
        {kind === "settings" && settingsTarget === "standards" && select("category", "Phân loại", standardCategories)}
        {kind !== "settings" && select("dateField", "Lọc theo ngày", kind === "todo" ? { created: "Ngày tạo", due: "Deadline hiện tại", completed: "Ngày hoàn thành", follow_up: "Ngày theo dõi lại" } : { due: "Hạn công việc", completed: "Ngày đạt", verified: "Ngày xác minh" }, "Chọn loại ngày")}
        <label className={styles.field} htmlFor={`${id}-preset`}><span>{kind === "settings" ? "Ngày áp dụng" : "Khoảng thời gian"}</span><select aria-label={kind === "settings" ? "Ngày áp dụng" : "Khoảng thời gian"} id={`${id}-preset`} value={value.preset} onChange={event => set("preset", event.target.value)}>{Object.entries(datePresets).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {value.preset === "custom" && <>{(["from", "to"] as const).map(key => <label key={key} className={styles.field} htmlFor={`${id}-${key}`}><span>{key === "from" ? "Từ ngày" : "Đến ngày"}</span><Input aria-label={key === "from" ? "Từ ngày" : "Đến ngày"} id={`${id}-${key}`} type="date" value={value[key]} onChange={event => set(key, event.target.value)} /></label>)}</>}
      </>}
    </div>
    {!(kind === "settings" && settingsTarget === "policies") && <details className={styles.filterDetails}><summary>Tiêu chí bổ sung{active ? ` (${active})` : ""}</summary><div className={styles.filterGrid}>
      {kind === "todo" && <>{select("category", "Phân loại", categories)}{select("priority", "Mức độ", priorities)}<UserPicker label="Người phối hợp" value={value.collaborator} onChange={(id) => set("collaborator",id)} options={people}/></>}
      {kind === "run" && <>{select("quality", "Kết quả", { met: states.met, unmet: states.unmet, unknown: states.unknown })}{select("verification", "Xác minh", { pending_review: "Chờ xác minh đến hạn", unverified: "Chưa xác minh", verified: "Đã xác minh" })}{select("standard", "Mẫu công việc", Object.fromEntries(standards.map(s => [s.id, `${s.title} · v${s.revision}`])))}{select("frequency", "Tần suất", frequencyLabels)}</>}
      {kind !== "settings" && select("deadline", "Tình trạng hạn", { overdue: "Quá hạn chưa hoàn thành", upcoming: "Chưa đến hạn", on_time: "Hoàn thành đúng hạn gốc", late: "Hoàn thành trễ hạn gốc", ...(kind === "todo" ? { follow_up: "Đến ngày theo dõi lại" } : {}) })}
      {kind === "settings" && settingsTarget === "standards" && <>{select("frequency", "Tần suất", frequencyLabels)}{select("scope", "Phạm vi", { common: "Mẫu chung", branch: "Riêng chi nhánh" })}</>}
      {kind === "settings" && settingsTarget === "members" && <>{select("role", "Vai trò", { manager: "Quản lý", reviewer: "Xác minh", collaborator: "Phối hợp" })}{select("active", "Tình trạng phân công", { true: "Đang áp dụng", false: "Ngừng áp dụng" })}</>}
    </div></details>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {kind !== "settings" && !error && <p className={styles.filterHint}>{calendar} · Giờ Việt Nam</p>}
  </div>;
}
