"use client";
import {
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
  type ReactElement,
} from "react";
import type {
  Criterion,
  Observation,
  Person,
  Workspace,
} from "@/lib/operations/contracts";
import { categories, priorities } from "@/lib/operations/contracts";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import { formatNumber } from "@/lib/format";
import s from "./quality.module.css";
import { UserPicker, type UserPurpose } from "./user-picker";
import { ScheduleDateInput, ScheduleTimeInput } from "./schedule-input";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  const control = children(id);
  return (
    <label className={s.field} htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      {isValidElement(control)
        ? cloneElement(control as ReactElement<Record<string, unknown>>, {
            "aria-labelledby": `${id}-label`,
          })
        : control}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function SelectField({
  label,
  name,
  options,
  value,
  required,
  onChange,
  multiple,
  allowEmpty = true,
  emptyLabel,
  userPurpose,
}: {
  label: string;
  name?: string;
  options: Record<string, string> | Person[];
  value?: string | string[];
  required?: boolean;
  onChange?: (v: string) => void;
  multiple?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  userPurpose?: UserPurpose;
}) {
  if (userPurpose) return <UserPicker label={label} name={name} purpose={userPurpose} value={value} onChange={onChange} multiple={multiple} required={required}/>;
  const entries = Array.isArray(options)
    ? options.map((p) => [p.id, p.name])
    : Object.entries(options);
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          name={name}
          defaultValue={onChange ? undefined : (value ?? (multiple ? [] : ""))}
          value={onChange ? value : undefined}
          required={required}
          multiple={multiple}
          onChange={(e) => onChange?.(e.target.value)}
        >
          {!multiple && allowEmpty && (
            <option value="">{emptyLabel ?? (required || !onChange ? "Chưa chọn" : "Tất cả")}</option>
          )}
          {entries.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
export function TextField({
  label,
  name,
  value = "",
  type = "text",
  required = false,
  hint,
  step,
}: {
  label: string;
  name: string;
  value?: string | number;
  type?: string;
  required?: boolean;
  hint?: string;
  step?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        type === 'date' ? <ScheduleDateInput id={id} name={name} defaultValue={String(value)} required={required}/> :
        type === 'time' ? <ScheduleTimeInput id={id} name={name} defaultValue={String(value)} required={required}/> :
        <input
          id={id}
          name={name}
          defaultValue={value}
          type={type}
          required={required}
          step={step}
          maxLength={type === "text" ? 200 : undefined}
        />
      )}
    </Field>
  );
}
export function Notes({
  label = "Ghi chú",
  name = "note",
  required = false,
  value = "",
}: {
  label?: string;
  name?: string;
  required?: boolean;
  value?: string;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <textarea
          id={id}
          name={name}
          defaultValue={value}
          required={required}
          maxLength={5000}
        />
      )}
    </Field>
  );
}
export const vnToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const inputTime = (v: string) =>
  new Date(Date.parse(v) + 7 * 3600000).toISOString().slice(0, 16);
export function ObservationFields({
  criteria,
  observations,
  onChange,
}: {
  criteria: Criterion[];
  observations: Observation[];
  onChange: (v: Observation[]) => void;
}) {
  function update(c: Criterion, slot: string, value: Partial<Observation>) {
    const old = observations.find(
      (o) => o.criterionId === c.id && o.slot === slot,
    );
    const next = { ...old, criterionId: c.id, slot, ...value } as Observation;
    onChange([
      ...observations.filter(
        (o) => !(o.criterionId === c.id && o.slot === slot),
      ),
      next,
    ]);
  }
  return (
    <div className={s.observations}>
      {criteria.map((c) => (
        <section key={c.id} className={s.criterion}>
          <h3>{c.title}</h3>
          <p className={s.muted}>
            {c.measurementScope} ·{" "}
            {c.operator === "lt"
              ? "Nhỏ hơn"
              : c.operator === "lte"
                ? "Không quá"
                : c.operator === "gte"
                  ? "Từ"
                  : "Bằng"}{" "}
            {formatNumber(c.threshold)}
            {c.kind === "percent" ? "%" : ""}
          </p>
          {Array.from({ length: c.samples }, (_, i) => String(i + 1)).map(
            (slot) => {
              const o = observations.find(
                (v) => v.criterionId === c.id && v.slot === slot,
              );
              return (
                <div key={slot} className={s.ruleFields}>
                  {c.kind === "boolean" ? (
                    <SelectField
                      label={`Lần ${slot}${c.measurementTimes?.[Number(slot) - 1] ? ` · ${c.measurementTimes[Number(slot) - 1]}` : ""}`}
                      options={{
                        "1": c.threshold === 1 ? "Đạt" : "Không đạt",
                        "0": c.threshold === 0 ? "Đạt" : "Không đạt",
                      }}
                      value={o?.value === undefined ? "" : String(o.value)}
                      required
                      onChange={(v) =>
                        update(c, slot, {
                          value: v === "" ? undefined : Number(v),
                        })
                      }
                    />
                  ) : c.kind === "percent" ? (
                    <>
                      <Field label={`Lần ${slot} · Số hao hụt`}>
                        {(id) => (
                          <input
                            id={id}
                            type="number"
                            step="any"
                            min="0"
                            required
                            value={o?.numerator ?? ""}
                            onChange={(e) =>
                              update(c, slot, {
                                numerator:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                                value: 0,
                              })
                            }
                          />
                        )}
                      </Field>
                      <Field label="Số làm căn cứ tính tỷ lệ">
                        {(id) => (
                          <input
                            id={id}
                            type="number"
                            step="any"
                            min="0.000001"
                            required
                            value={o?.denominator ?? ""}
                            onChange={(e) =>
                              update(c, slot, {
                                denominator:
                                  e.target.value === ""
                                    ? undefined
                                    : Number(e.target.value),
                                value: 0,
                              })
                            }
                          />
                        )}
                      </Field>
                    </>
                  ) : (
                    <Field
                      label={`Lần ${slot}${c.kind === "duration" ? " · phút" : ""}`}
                    >
                      {(id) => (
                        <input
                          id={id}
                          type="number"
                          step="any"
                          required
                          value={o?.value ?? ""}
                          onChange={(e) =>
                            update(c, slot, {
                              value:
                                e.target.value === ""
                                  ? undefined
                                  : Number(e.target.value),
                            })
                          }
                        />
                      )}
                    </Field>
                  )}
                  <Field
                    label={`Minh chứng lần ${slot}${c.evidenceRequired ? " *" : ""}`}
                  >
                    {(id) => (
                      <input
                        id={id}
                        required={c.evidenceRequired}
                        maxLength={1000}
                        value={o?.evidence ?? ""}
                        onChange={(e) =>
                          update(c, slot, { evidence: e.target.value })
                        }
                      />
                    )}
                  </Field>
                </div>
              );
            },
          )}
        </section>
      ))}
    </div>
  );
}
export function IssueFields({
  workspace,
  quality,
  prefix = "",
  initialTitle = "",
}: {
  workspace: Workspace;
  quality: QualityWorkspace;
  prefix?: string;
  initialTitle?: string;
}) {
  const managers = workspace.people.filter((u) =>
    workspace.members.some(
      (m) => m.user_id === u.id && m.member_role === "manager" && m.active,
    ),
  );
  return (
    <div className={s.formStack}>
      <TextField
        label="Nội dung cần xử lý"
        name={`${prefix}title`}
        value={initialTitle}
        required
      />
      <Notes
        label="Mô tả vấn đề / lô hàng / thiết bị"
        name={`${prefix}description`}
        required
      />
      <div className={s.ruleFields}>
        <SelectField
          label="Quản lý chịu trách nhiệm"
          name={`${prefix}assigneeId`}
          userPurpose="manager"
          options={managers}
          value=""
          required
        />
        <SelectField
          label="Phân loại"
          name={`${prefix}category`}
          options={categories}
          value="operations"
          required
        />
        <SelectField
          label="Mức độ"
          name={`${prefix}priority`}
          options={priorities}
          value="normal"
          required
        />
        <TextField
          label="Deadline (giờ Việt Nam)"
          name={`${prefix}dueAt`}
          type="datetime-local"
          required
        />
        <SelectField
          label="Bộ phận phối hợp (không bắt buộc)"
          name={`${prefix}departmentId`}
          options={quality.departments
            .filter((d) => d.active)
            .map((d) => ({ id: d.id, name: d.title }))}
        />
        <SelectField
          label="Người xử lý (có thể nhận việc sau)"
          name={`${prefix}operatorId`}
          userPurpose="participant"
          options={workspace.people}
        />
      </div>
      <SelectField
        label="Người phối hợp"
        name={`${prefix}collaborators`}
        userPurpose="participant"
        options={workspace.people}
        multiple
      />
    </div>
  );
}
export function issuePayload(form: FormData, prefix = "") {
  const value = (k: string) => String(form.get(prefix + k) ?? "");
  return {
    title: value("title"),
    description: value("description"),
    assigneeId: value("assigneeId"),
    category: value("category"),
    priority: value("priority"),
    dueAt: value("dueAt")
      ? new Date(`${value("dueAt")}:00+07:00`).toISOString()
      : null,
    departmentId: value("departmentId") || null,
    operatorId: value("operatorId") || null,
    collaborators: form.getAll(prefix + "collaborators").map(String),
  };
}
