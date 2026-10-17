"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import type { Person } from "@/lib/operations/contracts";
import { Icon } from "@/components/ui/icon";
import styles from "./user-picker.module.css";

export type UserPurpose = "manager" | "participant" | "membership" | "qc_grant" | "department";
export const UserBranchContext = createContext("");

export function UserPicker({ name, label, branch, purpose = "participant", value, onChange, onValuesChange,
  multiple = false, required = false, disabled = false, options, emptyHint,
}: {
  name?: string; label: string; branch?: string; purpose?: UserPurpose;
  value?: string | string[]; onChange?: (value: string) => void;
  onValuesChange?: (values: string[], people: Person[]) => void;
  multiple?: boolean; required?: boolean; disabled?: boolean; options?: Person[];
  emptyHint?: React.ReactNode;
}) {
  const id = useId();
  const inheritedBranch = useContext(UserBranchContext);
  branch = branch ?? inheritedBranch;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const initial = Array.isArray(value) ? value : value ? [value] : [];
  const [selected, setSelected] = useState(initial);
  const [result, setResult] = useState<{ key: string; people: Person[]; error: string }>({key:"",people:[],error:""});
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const requestKey = `${branch}:${purpose}:${retry}`;
  const loading = !!branch && result.key !== requestKey;
  const people = loading ? [] : result.people;
  const error = branch && result.key === requestKey ? result.error : "";
  const controlled = onChange || onValuesChange ? initial : selected;
  useEffect(() => {
    if (!branch) return;
    const controller = new AbortController();
    fetch(`/api/operations/people?${new URLSearchParams({ branch, purpose })}`, {
      signal: controller.signal, cache: "no-store",
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Không tải được danh sách người.");
      if (!controller.signal.aborted) setResult({key:requestKey,people:result.people,error:""});
    }).catch((err) => {
      if (!controller.signal.aborted) setResult({key:requestKey,people:[],error:err instanceof Error ? err.message : "Không tải được danh sách người."});
    });
    return () => controller.abort();
  }, [branch, purpose, requestKey]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const pool = branch ? people : options ?? people;
  const valid = controlled.filter((key) => pool.some((person) => person.id === key));
  const stale = !loading && !error && valid.length !== controlled.length;
  const change = (keys: string[]) => {
    setSelected(keys); onChange?.(keys[0] ?? "");
    onValuesChange?.(keys, keys.map(key => pool.find(person => person.id === key)).filter((person): person is Person => !!person));
    root.current?.dispatchEvent(new Event("input", { bubbles: true }));
    root.current?.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const choose = (key: string) => {
    change(multiple ? (valid.includes(key) ? valid.filter((item) => item !== key) : [...valid, key]) : [key]);
    setQuery(""); if (!multiple) { setOpen(false); root.current?.focus(); }
  };
  const matches = pool.filter((person) => (multiple || !valid.includes(person.id)) &&
    person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className={styles.root} ref={root} tabIndex={-1}>
    <span id={`${id}-label`} className={styles.label}>{label}{required ? " *" : ""}</span>
    <div className={styles.control}>
      {controlled.map((key) => <span key={key} className={styles.chip}>
        {pool.find((person) => person.id === key)?.name ?? (loading ? "Đang kiểm tra…" : "Cần chọn lại người")}
        <button type="button" disabled={disabled} title={`Bỏ ${pool.find((person) => person.id === key)?.name ?? "người đã chọn"}`} aria-label={`Bỏ ${pool.find((person) => person.id === key)?.name ?? "người đã chọn"}`} onClick={() => change(controlled.filter((item) => item !== key))}><span aria-hidden="true">×</span></button>
      </span>)}
      {(multiple || !controlled.length) && <button ref={button} className={styles.add} type="button" disabled={disabled || loading || !!error}
        aria-labelledby={`${id}-label ${id}-button`} aria-expanded={open} aria-controls={`${id}-list`}
        onClick={() => setOpen(!open)}>{multiple && <Icon name="add" size={16}/>}<span id={`${id}-button`}>{loading ? "Đang tải…" : multiple && controlled.length ? "Thêm người" : "Chọn người"}</span></button>}
    </div>
    {/* Native validity and FormData remain compatible with existing guarded forms. */}
    <select className={styles.validation} tabIndex={-1} aria-hidden="true" aria-label={`${label}: kiểm tra lựa chọn`}
      name={name} multiple={multiple} value={multiple ? (stale || error || loading ? [] : valid) : stale || error || loading ? "" : valid[0] ?? ""}
      required={required || stale || !!error || loading} disabled={disabled}
      onChange={() => {}} onInvalid={() => (button.current ?? root.current?.querySelector("button"))?.focus()}>
      {!multiple && <option value=""/>}{pool.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
    </select>
    {stale && <small role="alert">Người đã chọn không còn hợp lệ tại chi nhánh này. Bỏ lựa chọn cũ và chọn lại.</small>}
    {error && <small role="alert">{error} <button type="button" onClick={() => setRetry((n) => n + 1)}>Thử lại</button></small>}
    {!loading && !error && !pool.length && <small role="status">{emptyHint ?? (purpose === "manager" ? "Chưa có quản lý đủ điều kiện tại chi nhánh này. Kiểm tra quyền Xem Hub, Ghi kết quả và phân công Quản lý Hub trong Thiết lập." : "Chưa có tài khoản phù hợp trong phạm vi này.")}</small>}
    {open && <div className={styles.popup} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
      <input autoFocus aria-label={`Tìm ${label.toLowerCase()}`} placeholder="Tìm theo tên…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <ul id={`${id}-list`} aria-label={`Danh sách ${label.toLowerCase()}`}>
        {matches.map((person) => <li key={person.id}><button type="button" aria-pressed={multiple ? valid.includes(person.id) : undefined} onClick={() => choose(person.id)}>{person.name}<Icon name={valid.includes(person.id) ? "check" : "add"} size={16}/></button></li>)}
        {!matches.length && <li className={styles.empty}>Không có người phù hợp.</li>}
      </ul>
    </div>}
  </div>;
}
