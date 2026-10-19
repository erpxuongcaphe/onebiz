"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { Workspace } from "@/lib/operations/contracts";
import { ceoWorkingNotes, ceoWorkingRows, parseWorkingWorkbook, workingHeaders, workingImportSchema, type WorkingRow } from "@/lib/operations/workbook-import";
import { UserPicker } from "./user-picker";
import { ScheduleDateInput, ScheduleTimeInput } from "./schedule-input";
import { RecurrenceFields } from "./recurrence-fields";
import { frequencyLabels } from "@/lib/operations/recurrence";
import { formatNumber } from "@/lib/format";
import { vnToday } from "./quality-fields";
import s from "./quality.module.css";
import w from "./working-import.module.css";

type Batch = { id: string; state: string; created_at: string; manifest: { branchId: string; standardId: string; code: string; row: WorkingRow }[] };
export function WorkingImport({ workspace, onImported }: { workspace: Workspace; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WorkingRow[]>([]);
  const [notes, setNotes] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [approve, setApprove] = useState<string | null>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [changed, setChanged] = useState(false);
  const lock = useRef(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const loadToken = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const token = ++loadToken.current;
    try {
      const response = await fetch("/api/operations/workbook", { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (!signal?.aborted && token === loadToken.current) setBatches(result.batches);
    } catch (err) { if (!signal?.aborted && token === loadToken.current) setError(err instanceof Error ? err.message : "Chưa đọc được các bộ đã nhập."); }
  }, []);
  useEffect(() => { if (!open) return; const controller=new AbortController(); void load(controller.signal); return () => controller.abort(); }, [open, load]);
  function update(index: number, patch: Partial<WorkingRow>) { setRows((current) => current.map((row, at) => at === index ? { ...row, ...patch } : row)); setMessage(""); }
  function useSource() { setRows(ceoWorkingRows.map((row) => ({ ...row }))); setNotes(ceoWorkingNotes); setFileErrors([]); setMessage(""); }
  async function read(file?: File) {
    if (!file || busy) return;
    setFileErrors([]); setMessage("");
    if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 5 * 1024 * 1024) { setFileErrors(["Chọn file .xlsx tối đa 5 MB."]); return; }
    setBusy(true);
    try {
      const x = await import("xlsx");
      const book = x.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet?.["!ref"]) throw Error("File chưa có dữ liệu.");
      const range = x.utils.decode_range(sheet["!ref"]);
      if (range.e.r > 1000 || range.e.c > 30) throw Error("File có vùng dữ liệu quá lớn. Dùng đúng mẫu công việc.");
      if (Object.entries(sheet).some(([key, value]) => !key.startsWith("!") && value?.f)) throw Error("Các ô nhập phải là giá trị, không dùng công thức Excel.");
      const parsed = parseWorkingWorkbook(x.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", range: { s: { r: 0, c: 0 }, e: range.e } }));
      setRows(parsed.rows); setNotes(parsed.notes);
      setFileErrors(parsed.errors.map((item) => `Dòng ${item.row}, cột ${item.column}: ${item.reason}`));
    } catch (err) { setRows([]); setFileErrors([err instanceof Error ? err.message : "Không đọc được file."]); }
    finally { setBusy(false); }
  }
  async function template() {
    try {
      const x = await import("xlsx"); const book = x.utils.book_new();
      const sheet = x.utils.aoa_to_sheet([[...workingHeaders,'Ngày lặp','Tháng lặp'], ...ceoWorkingRows.map((row) => [row.number, row.group, row.title, row.requirement, row.scope, frequencyLabels[row.frequency], row.points,row.dayNumber??'',row.monthNumber??''])]);
      sheet["!cols"] = [8, 30, 34, 100, 20, 18, 12, 14, 14].map((wch) => ({ wch }));
      x.utils.book_append_sheet(book, sheet, "Cong viec");
      const guide = x.utils.aoa_to_sheet([
        ["HƯỚNG DẪN NHẬP CÔNG VIỆC"],
        ["1", "Sheet Cong viec có 34 mục từ file CEO. Có thể thêm, sửa hoặc xóa dòng trước khi nhập."],
        ["2", "Giữ 7 tiêu đề gốc và 2 cột lịch bổ sung: Ngày lặp, Tháng lặp. File cũ 7 cột vẫn nhập được. STT là mã ổn định, không trùng."],
        ["3", "Phân loại, công việc và tiêu chí: nhập nội dung nghiệp vụ. Tiêu chí tối đa 300 ký tự."],
        ["4", "Phạm vi: Chung. Mỗi dòng có lịch riêng: Một lần, Hằng ngày/tuần/tháng/quý/năm. Tuần cần Ngày lặp (1–7), tháng/quý/năm cần Ngày lặp (1–31); quý cần Tháng lặp (1–3), năm cần Tháng lặp (1–12). Không chọn thứ chung cho cả bảng. Điểm dùng số US; không dùng công thức."],
        ["5", "Lên Hub chọn file, xem trước, chọn chi nhánh, người phụ trách, lịch và ngày áp dụng. Không cần gõ mã tài khoản."],
        ["6", "Lưu bản nháp chưa sinh lịch hay chấm điểm. CEO kiểm tra rồi duyệt bộ để áp dụng công việc và QC cùng lúc."],
        ["7", "Lỗi ghi theo dòng/cột. Không ghi một phần nếu gói có lỗi. Không tự thay thế bộ đã nhập trùng mã."],
        ["8", "Điểm liệt, số lần kiểm tra, minh chứng và chính sách thưởng cần CEO cấu hình riêng; không tự áp dụng ghi chú thành quỹ thưởng."],
        ["Ghi chú nguyên bản của CEO", ceoWorkingNotes],
      ]); guide["!cols"] = [{ wch: 30 }, { wch: 125 }]; x.utils.book_append_sheet(book, guide, "Huong dan");
      x.writeFile(book, "OneBiz_Cong_viec_va_tieu_chi_CEO.xlsx");
    } catch { setError("Chưa tạo được mẫu. Hãy thử lại."); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || busy) return;
    setError(""); setMessage("");
    if (fileErrors.length) { setError("File còn lỗi. Sửa file và chọn lại trước khi lưu."); return; }
    const form = new FormData(event.currentTarget);
    const incomplete=rows.filter(row=>row.frequency==='weekly'&&!row.dayNumber);
    if(incomplete.length){setFilter('');setError(`Chọn thứ riêng tại ${incomplete.map(row=>`mục ${row.number}: ${row.title}`).join('; ')} trước khi lưu.`);return;}
    const body = { rows, assignments: branches.map((branchId) => ({ branchId, assigneeIds: form.getAll(`manager-${branchId}`).map(String) })), effectiveFrom: form.get("effectiveFrom"), dueTime: form.get("dueTime"), weeklyDay: 1 };
    const signature = JSON.stringify(body);
    if (request.current?.body !== signature) request.current = { body: signature, id: crypto.randomUUID() };
    const parsed = workingImportSchema.safeParse({ ...body, requestId: request.current.id });
    if (!parsed.success) { setError("Kiểm tra đầy đủ công việc, điểm, chi nhánh, người phụ trách và lịch. Chưa có dữ liệu được ghi."); return; }
    lock.current = true; setBusy(true);
    try {
      const response = await fetch("/api/operations/workbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setMessage("Đã lưu toàn bộ thành bản nháp. Chưa sinh lịch hoặc áp dụng điểm QC. Kiểm tra bộ bên dưới trước khi duyệt.");
      setRows([]); request.current = null; await load(); setChanged(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Chưa lưu được gói."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function activate(id: string) {
    if (busy || lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/workbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: id, activate: true }) });
      const result = await response.json(); if (!response.ok) throw Error(result.error);
      setApprove(null); setMessage("Đã duyệt công việc và QC cùng một gói. Chính sách thưởng vẫn theo cấu hình CEO duyệt riêng."); await load(); setChanged(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Chưa duyệt được gói."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function discardBatch(id: string) {
    if (busy || lock.current || discardReason.trim().length < 5) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/operations/workbook", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:id,discard:true,reason:discardReason})});
      const result=await response.json(); if (!response.ok) throw Error(result.error);
      setDiscardId(null);setDiscardReason("");setMessage("Đã hủy bộ nháp chưa dùng. Lịch sử thao tác được giữ lại; có thể chỉnh file rồi nhập lại.");await load();setChanged(true);
    } catch(err) {setError(err instanceof Error ? err.message : "Chưa hủy được bộ nháp.");}
    finally {lock.current=false;setBusy(false);}
  }
  function close() { if (busy) return; setOpen(false); if (changed) { setChanged(false); onImported(); } }
  return <>
    <button type="button" onClick={() => setOpen(true)}><Icon name="upload" size={16}/>Nhập công việc và tiêu chí Excel</button>
    <Dialog open={open} protectUnsavedChanges={rows.length > 0} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className={`${s.dialog} ${w.dialog} translate-x-0 translate-y-0`} showCloseButton={false}>
        <header className={s.dialogHeader}><DialogTitle>Công việc và bộ tiêu chí của CEO</DialogTitle></header>
        <form className={s.dialogForm} onSubmit={(event) => void save(event)}>
          <fieldset className={w.body} disabled={busy}>
            <div className={s.actions}>
              <button type="button" onClick={useSource}><Icon name="add" size={16}/>Nạp 34 mục từ file CEO</button>
              <button type="button" onClick={() => void template()}><Icon name="download" size={16}/>Tải bộ tiêu chí và hướng dẫn</button>
              <label className={w.file}>Chọn file .xlsx<input type="file" accept=".xlsx" onChange={(event) => void read(event.target.files?.[0])}/></label>
            </div>
            {(error || message) && <p role={error ? "alert" : "status"} className={error ? s.alert : w.success}>{error || message}</p>}
            {!!fileErrors.length && <ul role="alert" className={s.alert}>{fileErrors.map((item, at) => <li key={at}>{item}</li>)}</ul>}
            {!!rows.length && <>
              <h3>{formatNumber(rows.length)} mục · {new Set(rows.map((row) => row.group)).size} nhóm</h3>
              <div className={w.settings}>
                <label>Ngày bắt đầu<ScheduleDateInput aria-label="Ngày bắt đầu" name="effectiveFrom" min={vnToday()} required/></label>
                <label>Hạn hoàn thành trong ngày (24 giờ)<ScheduleTimeInput name="dueTime" required/></label>
              </div>
              <section><h3>Chi nhánh và người phụ trách</h3><div className={w.branchGrid}>{workspace.branches.filter((branch) => branch.capabilities.includes("approve_policy")).map((branch) => <div className={w.branch} key={branch.id}>
                <label><input type="checkbox" checked={branches.includes(branch.id)} onChange={(event) => setBranches((old) => event.target.checked ? [...old, branch.id] : old.filter((id) => id !== branch.id))}/>{branch.name}</label>
                {branches.includes(branch.id) && <UserPicker label="Quản lý phụ trách" branch={branch.id} purpose="manager" name={`manager-${branch.id}`} multiple required/>}
              </div>)}</div></section>
              <div className={s.actions}><input aria-label="Tìm công việc trong bản nhập" placeholder="Tìm nhóm, công việc hoặc tiêu chí…" value={filter} onChange={(event) => setFilter(event.target.value)}/><button type="button" onClick={() => {setFilter("");setRows((old) => [...old, { number: Math.max(0, ...old.map((row) => row.number)) + 1, group: "", title: "", requirement: "", scope: "Chung", frequency: "once", points: NaN, critical: false, accountingRequired: false }]);}}><Icon name="add" size={16}/>Thêm mục</button></div>
              <div className={w.rows}>{rows.map((row, index) => <fieldset className={w.row} key={index} hidden={!!filter && !`${row.group} ${row.title} ${row.requirement}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())}>
                <legend>Mục {row.number}</legend>
                <div className={w.settings}>
                  <label>STT<input aria-label={`STT mục ${index + 1}`} type="number" min={1} max={9999} required value={row.number} onChange={(event) => update(index, { number: Number(event.target.value) })}/></label>
                  <label>Nhóm<input required maxLength={120} value={row.group} onChange={(event) => update(index, { group: event.target.value })}/></label>
                  <label>Công việc<input required maxLength={200} value={row.title} onChange={(event) => update(index, { title: event.target.value })}/></label>
                </div>
                <label>Tiêu chí đánh giá<textarea required maxLength={300} value={row.requirement} onChange={(event) => update(index, { requirement: event.target.value })}/></label>
                <div className={w.settings}>
                  <RecurrenceFields frequency={row.frequency} allowUnselectedDay dayNumber={row.dayNumber??(row.frequency==='weekly'?0:1)} monthNumber={row.monthNumber??1} onChange={frequency=>update(index,{frequency:frequency==='event'?'once':frequency,dayNumber:frequency==='weekly'?undefined:1,monthNumber:frequency==='quarterly'||frequency==='yearly'?1:undefined})} onDayChange={dayNumber=>update(index,{dayNumber:dayNumber||undefined})} onMonthChange={monthNumber=>update(index,{monthNumber})}/>
                  <label>Điểm cộng / trừ<input type="number" step="0.01" min={-1000} max={1000} required value={Number.isFinite(row.points) ? row.points : ""} onChange={(event) => update(index, { points: event.target.value === "" ? NaN : Number(event.target.value) })}/></label>
                  <div className={w.flags}><label><input type="checkbox" checked={row.critical} onChange={(event) => update(index, { critical: event.target.checked })}/>Vi phạm loại thưởng</label><label><input type="checkbox" checked={row.accountingRequired} onChange={(event) => update(index, { accountingRequired: event.target.checked })}/>Cần xác nhận kế toán</label></div>
                </div>
                <button type="button" aria-label={`Bỏ mục ${row.number}: ${row.title || "chưa đặt tên"}`} onClick={() => setRows((old) => old.filter((_, at) => at !== index))}><Icon name="delete" size={16}/>Bỏ khỏi bản nhập</button>
              </fieldset>)}</div>
              {notes && <details className={w.notes}><summary>Ghi chú chính sách trong file CEO</summary><p>{notes}</p><strong>Chưa tự áp dụng quỹ thưởng hoặc điều kiện điểm liệt. Cần CEO kiểm tra cờ vi phạm ở từng mục và duyệt chính sách thưởng riêng.</strong></details>}
              <label className={s.check}><input type="checkbox" required name="confirmed"/>Tôi đã kiểm tra nội dung, điểm, lịch, phân công và các cờ loại thưởng/xác nhận kế toán. Lưu nháp chưa áp dụng.</label>
            </>}
            <section><h3>Các bộ đã lưu</h3>{batches.map((batch) => <article className={w.batch} key={batch.id}><strong>{new Set(batch.manifest.map((item) => item.code)).size} mục · {new Set(batch.manifest.map((item) => item.branchId)).size} chi nhánh · {batch.state === "approved" ? "Đã áp dụng" : batch.state === "discarded" ? "Đã hủy bản nháp" : "Bản nháp"}</strong>
              <details><summary>Xem nội dung đã lưu</summary>{batch.manifest.map((entry) => <p key={entry.standardId}>{entry.code} · {workspace.branches.find((branch) => branch.id === entry.branchId)?.name ?? "Chi nhánh"} · {entry.row.title}: {entry.row.requirement} · {entry.row.points > 0 ? "+" : ""}{entry.row.points} điểm</p>)}</details>
              {batch.state === "draft" && (approve === batch.id ? <div className={s.actions}><span>Duyệt toàn bộ công việc và QC theo bản nháp này?</span><button type="button" onClick={() => void activate(batch.id)}>Xác nhận duyệt áp dụng</button><button type="button" onClick={() => setApprove(null)}>Chưa duyệt</button></div> : <button type="button" onClick={() => setApprove(batch.id)}>Duyệt bộ công việc và QC</button>)}
              {batch.state === "draft" && (discardId === batch.id ? <div><label>Lý do hủy bản nháp<input value={discardReason} onChange={(event)=>setDiscardReason(event.target.value)} maxLength={1000}/></label><button type="button" disabled={discardReason.trim().length<5} onClick={()=>void discardBatch(batch.id)}>Xác nhận hủy bộ nháp chưa dùng</button><button type="button" onClick={()=>setDiscardId(null)}>Giữ bộ nháp</button></div> : <button type="button" onClick={()=>setDiscardId(batch.id)}>Hủy bộ nháp để chỉnh và nhập lại</button>)}
            </article>)}</section>
          </fieldset>
          <footer className={s.dialogFooter}><button type="button" disabled={busy} onClick={close}>Đóng</button><button type="submit" className={s.primary} disabled={busy || !rows.length || !!fileErrors.length || !branches.length}><Icon name="save" size={16}/>{busy ? "Đang xử lý…" : "Lưu toàn bộ thành bản nháp"}</button></footer>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
