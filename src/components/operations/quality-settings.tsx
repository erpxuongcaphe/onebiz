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
  catalog = [],
}: {
  people: Workspace["people"];
  value?: QualityRule;
  catalog?: QualityItem[];
}) {
  const [rule, setRule] = useState(value);
  const number = (label: string, key: keyof QualityRule, enabled = true) => (
    <Field key={key} label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          min="0"
          max="1000"
          step="0.01"
          name={key}
          disabled={!enabled}
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
      <input type="hidden" name="limitsVersion" value="1" />
      <p className={s.scopeNotice}>Theo file CEO: điểm cơ sở 100, quỹ QC 2,000,000 đồng, dưới 70 điểm không được thưởng. Các lựa chọn chưa được quy định cần được người có quyền xác nhận; lưu nháp chưa áp dụng chấm điểm.</p>
      <div className={s.formGrid}>
        <section>
          <h3>Điểm QC</h3>
          <div className={s.ruleFields}>
            {number("Điểm cơ sở", "baseScore")}
            {number("Điểm tối thiểu xét thưởng", "minimumScore")}
            <details className={s.ruleOptions}><summary>Giới hạn điểm và điểm khuyến khích</summary>
            {([['floor', 'Áp dụng sàn điểm', 'floorScore', 'Sàn điểm'], ['ceiling', 'Áp dụng trần điểm', 'capScore', 'Trần điểm'], ['bonus', 'Giới hạn tổng điểm cộng', 'bonusCap', 'Tổng điểm cộng tối đa mỗi kỳ']] as const).map(([key, label, field, inputLabel]) => <section key={key}>
              <label className={s.check}><input type="checkbox" name={`limit:${key}`} checked={rule.limits?.[key] ?? true} onChange={(event) => setRule((current) => ({ ...current, limits: { floor: true, ceiling: true, bonus: true, ...current.limits, [key]: event.target.checked } }))} />{label}</label>
              {number(inputLabel, field, rule.limits?.[key] ?? true)}
            </section>)}
            </details>
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
            <SelectField label="Lỗi chưa khắc phục qua kỳ mới" name="openIssueAcrossPeriods" emptyLabel="Chưa chọn" value={rule.openIssueAcrossPeriods ?? ""} options={{ each_period: "Chấm lại trong mỗi kỳ", once_until_closed: "Không trừ lại cùng lỗi khi chưa khắc phục" }} onChange={(next) => setRule((current) => ({ ...current, openIssueAcrossPeriods: next as QualityRule['openIssueAcrossPeriods'] }))} />
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
            <details className={s.ruleOptions} open={rule.businessFundCents !== null || undefined}><summary>Thưởng kinh doanh riêng</summary>
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
            </details>
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
      {catalog.some((item) => item.score_type === 'bonus') && <details className={s.ruleOptions}><summary>Giới hạn điểm cộng từng hạng mục trong kỳ</summary>{catalog.filter((item) => item.score_type === 'bonus').map((item) => {
        const limit = rule.bonusLimits?.find((entry) => entry.familyId === item.family_id);
        return <fieldset key={item.family_id} className={s.ruleFields}><legend>{item.title}</legend><TextField label="Số lần cộng tối đa" name={`bonusAwards:${item.family_id}`} type="number" step="1" value={limit?.maxAwards ?? ''} hint="Không giới hạn khi không đặt mức tối đa" /><TextField label="Số điểm cộng tối đa" name={`bonusPoints:${item.family_id}`} type="number" step="0.01" value={limit?.maxPoints ?? ''} hint="Không giới hạn khi không đặt mức tối đa" /></fieldset>;
      })}</details>}
      {qualityRuleIssues(rule).length > 0 && (
        <p className={s.muted}>Bản nháp: {qualityRuleIssues(rule).join(" ")}</p>
      )}
      <details className={s.section}><summary>Đối chiếu điều kiện không được thưởng trong file CEO</summary>
        <ul>
          <li>Phản hồi xấu đã xác minh về thời gian ra món, thái độ hoặc vệ sinh.</li>
          <li>Cà phê sai vị do nước, hạt hoặc máy mà không được báo trước.</li>
          <li>Có dị vật trong đồ uống.</li>
          <li>Mở cửa muộn hoặc đóng cửa sớm.</li>
          <li>Quản lý hoặc nhân viên tỏ thái độ với khách.</li>
          <li>Tổng điểm còn lại dưới 70.</li>
        </ul>
        <p>Ngưỡng điểm nằm trong chính sách này. Những vi phạm cụ thể cần đối chiếu tiêu chí QC và bằng chứng; không tự coi mọi lỗi trong một nhóm là lỗi loại thưởng.</p>
      </details>
    </>
  );
}
export function rulePayload(
  form: FormData,
  people: Workspace["people"],
  catalog: QualityItem[] = [],
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
    ...(form.get('limitsVersion') === '1' ? {
      limits: { floor: form.get('limit:floor') === 'on', ceiling: form.get('limit:ceiling') === 'on', bonus: form.get('limit:bonus') === 'on' },
      openIssueAcrossPeriods: (String(form.get('openIssueAcrossPeriods') ?? '') || undefined) as QualityRule['openIssueAcrossPeriods'],
      bonusLimits: catalog.filter((item) => item.score_type === 'bonus').map((item) => ({ familyId: item.family_id, maxAwards: num(`bonusAwards:${item.family_id}`), maxPoints: num(`bonusPoints:${item.family_id}`) })),
    } : {}),
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
export function CatalogFields({ workspace, groups = [], value }: { workspace: Workspace; groups?: {id:string;title:string;active:boolean}[]; value?: QualityItem }) {
  return (
    <div className={s.formGrid}>
      <SelectField
        label="Công việc đã được duyệt"
        name="standardId"
        value={value?.standard_id}
        options={workspace.standards
          .filter((x) => x.status === "approved")
          .map((x) => ({ id: x.id, name: x.title }))}
        required
      />
      <TextField label="Mã tiêu chuẩn QC" name="code" required value={value?.code}/>
      <SelectField
        label="Phân loại"
        name="category"
        value={value?.category}
        options={{...categories,...Object.fromEntries(groups.filter((group) => group.active).map((group) => [`group:${group.id}`, group.title]))}}
        required
      />
      <SelectField
        label="Loại điểm"
        name="scoreType"
        value={value?.score_type}
        options={{
          deduct: "Trừ khi không đạt",
          bonus: "Cộng khi đạt điều kiện",
        }}
        required
      />
      <TextField
        label="Trọng số (không nhập dấu âm)"
        name="weight"
        value={value?.weight}
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
        <input type="checkbox" name="critical" defaultChecked={value?.critical}/>
        Vi phạm loại thưởng QC
      </label>
      <label className={s.check}>
        <input type="checkbox" name="accountingRequired" defaultChecked={value?.accounting_required}/>
        Tỷ lệ cần số liệu kế toán đã xác nhận
      </label>
    </div>
  );
}
export function CatalogImport({
  workspace,
  catalog = [],
  groups = [],
  busy,
  onImport,
}: {
  workspace: Workspace;
  catalog?: QualityItem[];
  groups?: { id: string; title: string; active: boolean }[];
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
        ...groups.filter((group) => group.active).map((group) => [group.title]),
      ]),
      "Phan loai",
    );
    const guide = x.utils.aoa_to_sheet([
      ["HƯỚNG DẪN CẬP NHẬT QC CHO CÔNG VIỆC ĐÃ DUYỆT"],
      ["Mục đích", "Mẫu này không tạo công việc. Để nhập từ đầu, dùng Nhập công việc và tiêu chí Excel trong Thiết lập."],
      ["Mã công việc OneBiz", "Sao chép đúng mã từ sheet Cong viec da duyet; không tự tạo hoặc gõ mã tài khoản."],
      ["Mã tiêu chuẩn", "Mã nghiệp vụ tự đặt; không trùng cùng ngày hiệu lực trong file hoặc danh mục đã có."],
      ["Phân loại", "Chọn đúng tên từ sheet Phan loai. Nhóm QC có thể cấu hình trong Hub."],
      ["Loại điểm / Trọng số", "Loại điểm: Trừ hoặc Cộng. Trọng số không dấu âm, số US tối đa 2 số lẻ, ví dụ 5 hoặc 2.5."],
      ["Ngày hiệu lực", "dd/mm/yyyy; không nhập ngày đã qua."],
      ["Loại thưởng khi vi phạm", "Có hoặc Không. CEO quyết định theo chính sách, không suy diễn từ tên nhóm."],
      ["Cần xác nhận kế toán", "Có hoặc Không. Không để trống."],
      ["Kiểm tra", "Giữ nguyên thứ tự cột. Hub xem trước và báo dòng/cột lỗi; chỉ nhập khi toàn bộ hợp lệ."],
    ]); guide["!cols"] = [{wch:35},{wch:110}];
    x.utils.book_append_sheet(wb, guide, "Huong dan");
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
      const parsed = parseQualityCatalog(rows, catalog, workspace.standards.filter((standard) => standard.status === "approved").map((standard) => standard.id), Object.fromEntries(groups.filter((group) => group.active).map((group) => [`group:${group.id}`, group.title])));
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
      <h3>Nhập QC cho công việc đã duyệt</h3>
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
