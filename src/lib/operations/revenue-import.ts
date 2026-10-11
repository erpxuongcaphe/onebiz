import { parseMoneyUS } from "./policy";

export const ONEBIZ_REVENUE_DEFINITION =
  "OneBiz FnB: tổng hóa đơn hoàn thành sau giảm giá, gồm thuế, trừ trả hàng hoàn thành; ngày tạo chứng từ, giờ Việt Nam";
export const revenueHeaders = [
  "Mã chi nhánh",
  "Kỳ (mm/yyyy)",
  "Doanh thu",
  "Nguồn báo cáo",
  "Định nghĩa doanh thu",
  "Chứng từ",
  "Khóa bản ghi",
] as const;
export interface ImportIssue {
  row: number;
  column: string;
  message: string;
}
export interface RevenueImportRow {
  branchId: string;
  period: string;
  amountCents: number;
  source: "xlsx";
  sourceName: string;
  definition: { label: string };
  evidence: string;
  sourceKey: string;
}
export function validateRevenueRows(
  rows: unknown[][],
  branch: { id: string; code: string },
) {
  const issues: ImportIssue[] = [],
    valid: RevenueImportRow[] = [],
    seen = new Set<string>();
  if (
    !rows.length ||
    revenueHeaders.some((header, index) => rows[0][index] !== header) ||
    rows[0].length !== revenueHeaders.length
  )
    return {
      issues: [
        {
          row: 1,
          column: "Tiêu đề",
          message: "Cột phải đúng mẫu doanh thu tải từ OneBiz.",
        },
      ],
      rows: valid,
    };
  if (rows.length > 101)
    issues.push({
      row: 1,
      column: "File",
      message: "Mỗi lần nhập tối đa 100 dòng.",
    });
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    if (!cells.some((cell) => cell !== "" && cell != null)) continue;
    const get = (col: number) => String(cells[col] ?? "").trim();
    const fail = (col: number, message: string) =>
      issues.push({ row: index + 1, column: revenueHeaders[col], message });
    if (get(0) !== branch.code)
      fail(0, "Mã chi nhánh không khớp chi nhánh đang chọn.");
    if (!/^(0[1-9]|1[0-2])\/\d{4}$/.test(get(1)))
      fail(1, "Kỳ phải đúng mm/yyyy, ví dụ 10/2026.");
    const amount = parseMoneyUS(get(2));
    if (amount === null)
      fail(2, "Số US 1,234.56; không dùng 1.234,56 hoặc quá hai số thập phân.");
    for (const col of [3, 4, 5, 6])
      if (!get(col) || get(col).length > 1000)
        fail(col, "Bắt buộc, tối đa 1,000 ký tự.");
    if (seen.has(get(6))) fail(6, "Khóa bản ghi bị trùng trong file.");
    seen.add(get(6));
    valid.push({
      branchId: branch.id,
      period: `${get(1).slice(3)}-${get(1).slice(0, 2)}`,
      amountCents: amount ?? 0,
      source: "xlsx",
      sourceName: get(3),
      definition: { label: get(4) },
      evidence: get(5),
      sourceKey: get(6),
    });
  }
  if (!valid.length && !issues.length)
    issues.push({
      row: 2,
      column: "File",
      message: "File chưa có dòng dữ liệu.",
    });
  return { issues, rows: issues.length ? [] : valid };
}
