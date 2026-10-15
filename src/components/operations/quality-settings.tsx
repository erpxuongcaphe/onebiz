"use client";
import { useState, type FormEvent } from "react";
import { categories, type Workspace } from "@/lib/operations/contracts";
import {
  draftQualityRule,
  type QualityItem,
  type QualityRule,
} from "@/lib/operations/quality-contracts";
import { qualityRuleIssues } from "@/lib/operations/quality-policy";
import {
  parseQualityCatalog,
  qualityImportHeaders,
} from "@/lib/operations/quality-import";
import { formatNumber, formatShortDate } from "@/lib/format";
import { parseMoneyUS } from "@/lib/operations/policy";
import { Field, SelectField, TextField, vnToday } from "./quality-fields";
import s from "./quality.module.css";

export function RuleFields({
  people,
  value = draftQualityRule,
}: {
  people: Workspace["people"];
  value?: QualityRule;
}) {
  const [rule, setRule] = useState(value);
  const number = (label: string, key: keyof QualityRule) => (
    <Field key={key} label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min="0"
          max="1000"
          step="0.01"
          name={key}
          defaultValue={typeof rule[key] === "number" ? String(rule[key]) : ""}
          onChange={(e) =>
            setRule((r) => ({
              ...r,
              [key]: e.target.value === "" ? null : Number(e.target.value),
            }))
          }
        />
      )}
    </Field>
  );
  const bool = (label: string, key: keyof QualityRule) => (
    <SelectField
      key={key}
      label={label}
      name={key}
      options={{ true: "Có", false: "Không" }}
      value={rule[key] === null ? "" : String(rule[key])}
      emptyLabel="Chưa chọn"
      onChange={(value) =>
        setRule((r) => ({ ...r, [key]: value === "" ? null : value === "true" }))
      }
    />
  );
  return (
    <>
      <div className={s.formGrid}>
        <section>
          <h3>Điểm QC</h3>
          <div className={s.ruleFields}>
            {number("Điểm cơ sở", "baseScore")}
            {number("Điểm tối thiểu xét thưởng", "minimumScore")}
            {number("Sàn điểm", "floorScore")}
            {number("Trần điểm", "capScore")}
            {number("Tổng điểm cộng tối đa mỗi kỳ", "bonusCap")}
            <SelectField
              label="Lỗi lặp trong kỳ"
              name="repeatMode"
              options={{
                each_audit: "Mỗi đợt QC được chấm một lần",
                once_per_issue: "Mỗi sự việc / hạng mục trừ một lần trong kỳ",
              }}
              value={rule.repeatMode ?? ""}
              emptyLabel="Chưa chọn"
              onChange={(value) =>
                setRule((r) => ({
                  ...r,
                  repeatMode: (value || null) as QualityRule["repeatMode"],
                }))
              }
            />
            <SelectField
              label="Xét điểm tối thiểu"
              name="thresholdBasis"
              options={{
                before_bonus: "Trước khi cộng điểm khuyến khích",
                after_bonus: "Sau khi cộng điểm khuyến khích",
              }}
              value={rule.thresholdBasis ?? ""}
              emptyLabel="Chưa chọn"
              onChange={(value) =>
                setRule((r) => ({
                  ...r,
                  thresholdBasis: (value || null) as QualityRule["thresholdBasis"],
                }))
              }
            />
            {bool("Cho điểm/thưởng vượt 100", "allowAbove100")}
          </div>
        </section>
        <section>
          <h3>Hai quỹ thưởng riêng</h3>
          <div className={s.ruleFields}>
            <TextField
              label="Quỹ thưởng QC (đồng)"
              name="qcFund"
              value={
                rule.qcFundCents === null
                  ? ""
                  : formatNumber(rule.qcFundCents / 100)
              }
            />
            <TextField
              label="Quỹ thưởng kinh doanh (đồng)"
              name="businessFund"
              value={
                rule.businessFundCents === null
                  ? ""
                  : formatNumber(rule.businessFundCents / 100)
              }
            />
            <TextField
              label="Kinh doanh đạt tối thiểu (%)"
              name="businessThreshold"
              value={
                rule.businessThresholdBps === null
                  ? ""
                  : rule.businessThresholdBps / 100
              }
              type="number"
              step="0.01"
            />
            <TextField
              label="Tỷ lệ kinh doanh tối đa trả thưởng (%)"
              name="businessCap"
              value={
                rule.businessCapBps === null ? "" : rule.businessCapBps / 100
              }
              type="number"
              step="0.01"
            />
            {bool(
              "Vi phạm loại thưởng QC cũng loại thưởng kinh doanh",
              "blockBusinessOnCritical",
            )}
          </div>
          <h3 className={s.section}>Phân bổ quỹ tại chi nhánh</h3>
          {people.map((person) => (
            <Field key={person.id} label={`${person.name} · tỷ lệ (%)`}>
              {(id) => (
                <input
                  id={id}
                  name={`allocation:${person.id}`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={
                    (rule.allocations.find((a) => a.userId === person.id)
                      ?.shareBps ?? 0) / 100
                  }
                />
              )}
            </Field>
          ))}
        </section>
      </div>
      {qualityRuleIssues(rule).length > 0 && (
        <p className={s.muted}>Bản nháp: {qualityRuleIssues(rule).join(" ")}</p>
      )}
    </>
  );
}
export function rulePayload(
  form: FormData,
  people: Workspace["people"],
): QualityRule {
  const num = (name: string) =>
    form.get(name) === "" || form.get(name) === null
      ? null
      : Number(form.get(name));
  const bool = (name: string) =>
    form.get(name) === "" || form.get(name) === null
      ? null
      : form.get(name) === "true";
  const money = (name: string) => {
    const value = String(form.get(name) ?? "").trim();
    if (!value) return null;
    const parsed = parseMoneyUS(value);
    if (parsed === null) throw new Error("Số tiền phải đúng dạng 1,234.56.");
    return parsed;
  };
  return {
    baseScore: num("baseScore") ?? 100,
    minimumScore: num("minimumScore") ?? 70,
    floorScore: num("floorScore"),
    capScore: num("capScore"),
    bonusCap: num("bonusCap"),
    repeatMode: (String(form.get("repeatMode") ?? "") ||
      null) as QualityRule["repeatMode"],
    thresholdBasis: (String(form.get("thresholdBasis") ?? "") ||
      null) as QualityRule["thresholdBasis"],
    allowAbove100: bool("allowAbove100"),
    qcFundCents: money("qcFund"),
    businessFundCents: money("businessFund"),
    businessThresholdBps:
      num("businessThreshold") === null
        ? null
        : Math.round(num("businessThreshold")! * 100),
    businessCapBps:
      num("businessCap") === null
        ? null
        : Math.round(num("businessCap")! * 100),
    blockBusinessOnCritical: bool("blockBusinessOnCritical"),
    allocations: people
      .map((p) => ({
        userId: p.id,
        shareBps: Math.round((num(`allocation:${p.id}`) ?? 0) * 100),
      }))
      .filter((a) => a.shareBps > 0),
  };
}
export function CatalogFields({ workspace }: { workspace: Workspace }) {
  return (
    <div className={s.formGrid}>
      <SelectField
        label="Công việc đã được duyệt"
        name="standardId"
        options={workspace.standards
          .filter((x) => x.status === "approved")
          .map((x) => ({ id: x.id, name: x.title }))}
        required
      />
      <TextField label="Mã tiêu chuẩn QC (duy nhất)" name="code" required />
      <SelectField
        label="Phân loại"
        name="category"
        options={categories}
        required
      />
      <SelectField
        label="Loại điểm"
        name="scoreType"
        options={{
          deduct: "Trừ khi không đạt",
          bonus: "Cộng khi đạt điều kiện",
        }}
        required
      />
      <TextField
        label="Trọng số (không nhập dấu âm)"
        name="weight"
        type="number"
        step="0.01"
        required
      />
      <TextField
        label="Ngày hiệu lực"
        name="effectiveFrom"
        type="date"
        value={vnToday()}
        required
      />
      <label className={s.check}>
        <input type="checkbox" name="critical" />
        Vi phạm loại thưởng QC
      </label>
      <label className={s.check}>
        <input type="checkbox" name="accountingRequired" />
        Tỷ lệ cần số liệu kế toán đã xác nhận
      </label>
    </div>
  );
}
export function CatalogImport({
  workspace,
  catalog = [],
  busy,
  onImport,
}: {
  workspace: Workspace;
  catalog?: QualityItem[];
  busy: boolean;
  onImport: (
    rows: ReturnType<typeof parseQualityCatalog>["rows"],
  ) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<ReturnType<
    typeof parseQualityCatalog
  > | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  async function template() {
    const x = await import("xlsx");
    const wb = x.utils.book_new();
    x.utils.book_append_sheet(
      wb,
      x.utils.aoa_to_sheet([qualityImportHeaders]),
      "Tieu chuan QC",
    );
    x.utils.book_append_sheet(
      wb,
      x.utils.aoa_to_sheet([
        ["Mã công việc OneBiz", "Tên", "Ngày hiệu lực"],
        ...workspace.standards
          .filter((v) => v.status === "approved")
          .map((v) => [v.id, v.title, v.effective_from]),
      ]),
      "Cong viec da duyet",
    );
    x.utils.book_append_sheet(
      wb,
      x.utils.aoa_to_sheet([
        ["Phân loại"],
        ...Object.values(categories).map((v) => [v]),
      ]),
      "Phan loai",
    );
    x.writeFile(wb, "OneBiz_Mau_tieu_chuan_QC.xlsx");
  }
  async function read(file: File | undefined) {
    if (!file) return;
    setError("");
    setPreview(null);
    if (file.size > 5 * 1024 * 1024) {
      setError("Tệp tối đa 5 MB.");
      return;
    }
    setReading(true);
    try {
      const x = await import("xlsx");
      const wb = x.read(await file.arrayBuffer(), {
        type: "array",
        cellDates: false,
      });
      const rows = x.utils.sheet_to_json<unknown[]>(
        wb.Sheets[wb.SheetNames[0]],
        { header: 1, raw: false },
      );
      const parsed = parseQualityCatalog(rows, catalog, workspace.standards.filter((standard) => standard.status === "approved").map((standard) => standard.id));
      setPreview(parsed);
    } catch {
      setError("Không đọc được file Excel. Dùng đúng mẫu tải từ Hub.");
    } finally {
      setReading(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (preview && !preview.errors.length && (await onImport(preview.rows)))
      setPreview(null);
  }
  return (
    <section className={s.section}>
      <h3>Nhập danh mục Excel</h3>
      <div className={s.actions}>
        <button type="button" onClick={() => void template()}>
          Tải mẫu và danh mục công việc
        </button>
        <Field label="Chọn file .xlsx">
          {(id) => (
            <input
              id={id}
              type="file"
              accept=".xlsx"
              disabled={reading || busy}
              onChange={(e) => void read(e.target.files?.[0])}
            />
          )}
        </Field>
      </div>
      {error && (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      )}
      {preview && (
        <form onSubmit={submit}>
          <p>
            {preview.rows.length} dòng · {preview.errors.length} lỗi
          </p>
          {preview.errors.length > 0 ? (
            <ul role="alert">
              {preview.errors.map((e, i) => (
                <li key={i}>
                  Dòng {e.row}, cột {e.column}: {e.reason}
                </li>
              ))}
            </ul>
          ) : null}
          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Loại điểm</th>
                  <th className={s.numeric}>Trọng số</th>
                  <th>Hiệu lực</th>
                  <th>Xác nhận kế toán</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.code}</td>
                    <td>{r.scoreType === "bonus" ? "Cộng" : "Trừ"}</td>
                    <td className={s.numeric}>{formatNumber(r.weight)}</td>
                    <td>{formatShortDate(r.effectiveFrom)}</td>
                    <td>{r.accountingRequired ? "Bắt buộc" : "Không"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className={s.primary}
            disabled={busy || !!preview.errors.length}
          >
            Xác nhận nhập {preview.rows.length} dòng
          </button>
        </form>
      )}
    </section>
  );
}
