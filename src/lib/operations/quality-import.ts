import { z } from "zod";
import { categories } from "./contracts";

export const qualityImportHeaders = [
  "Mã tiêu chuẩn",
  "Mã công việc OneBiz",
  "Phân loại",
  "Loại điểm",
  "Trọng số",
  "Ngày hiệu lực",
  "Loại thưởng khi vi phạm",
  "Cần xác nhận kế toán",
];
export function parseQualityCatalog(
  rows: unknown[][],
  existing: { code: string; effective_from: string }[] = [],
  approvedStandardIds?: string[],
  qualityGroups: Record<string,string> = {},
) {
  const errors: { row: number; column: string; reason: string }[] = [];
  const seen = new Set<string>();
  const parsed: {
    code: string;
    standardId: string;
    category: string;
    scoreType: string;
    weight: number;
    effectiveFrom: string;
    critical: boolean;
    accountingRequired: boolean;
  }[] = [];
  const header = rows[0]?.map(String);
  if (!header || qualityImportHeaders.some((h, i) => header[i] !== h))
    return {
      rows: parsed,
      errors: [
        {
          row: 1,
          column: "Tiêu đề",
          reason: "Dùng đúng mẫu tải từ Hub; không đổi thứ tự cột.",
        },
      ],
    };
  rows.slice(1).forEach((row, i) => {
    if (!row.some((v) => String(v ?? "").trim())) return;
    const at = i + 2,
      [
        code,
        standardId,
        category,
        scoreType,
        rawWeight,
        effectiveFrom,
        critical,
        accountingRequired,
      ] = row.map((v) => String(v ?? "").trim());
    const add = (column: string, reason: string) =>
      errors.push({ row: at, column, reason });
    if (!code || code.length > 80 || seen.has(code))
      add(
        qualityImportHeaders[0],
        "Mã bắt buộc, tối đa 80 ký tự, không trùng trong file.",
      );
    seen.add(code);
    if (!z.uuid().safeParse(standardId).success)
      add(
        qualityImportHeaders[1],
        "Chọn mã công việc đã duyệt từ danh mục tải xuống.",
      );
    else if (approvedStandardIds && !approvedStandardIds.includes(standardId))
      add(qualityImportHeaders[1], "Công việc chưa được duyệt hoặc không thuộc phạm vi đang chọn.");
    const categoryKey = Object.entries({...categories,...qualityGroups}).find(
      ([k, v]) => k === category || v === category,
    )?.[0];
    if (!categoryKey)
      add(qualityImportHeaders[2], "Phân loại không có trong danh mục Hub.");
    const type =
      scoreType === "Trừ"
        ? "deduct"
        : scoreType === "Cộng"
          ? "bonus"
          : scoreType;
    if (!["deduct", "bonus"].includes(type))
      add(qualityImportHeaders[3], "Chọn Trừ hoặc Cộng.");
    const normalized = rawWeight.replace(/^−/, "-");
    const weight = Math.abs(Number(normalized));
    if (
      !/^[+-]?\d+(\.\d{1,2})?$/.test(normalized) ||
      !Number.isFinite(weight) ||
      weight > 1000 ||
      (normalized.startsWith("-") && type !== "deduct")
    )
      add(
        qualityImportHeaders[4],
        "Trọng số US tối đa 2 số lẻ; dấu âm chỉ dùng với Loại điểm Trừ.",
      );
    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(effectiveFrom);
    const iso = date ? `${date[3]}-${date[2]}-${date[1]}` : effectiveFrom;
    if (!z.iso.date().safeParse(iso).success)
      add(qualityImportHeaders[5], "Ngày phải hợp lệ theo dd/mm/yyyy.");
    if (existing.some((item) => item.code === code && item.effective_from === iso))
      add(qualityImportHeaders[0], "Mã và ngày hiệu lực đã có trên Hub. Không nhập lại cùng phiên bản.");
    if (!["Có", "Không"].includes(critical))
      add(qualityImportHeaders[6], "Chỉ nhận Có hoặc Không.");
    if (!["Có", "Không"].includes(accountingRequired))
      add(qualityImportHeaders[7], "Chọn Có hoặc Không; không để trống điều kiện kế toán.");
    parsed.push({
      code,
      standardId,
      category: categoryKey ?? "",
      scoreType: type,
      weight,
      effectiveFrom: iso,
      critical: critical === "Có",
      accountingRequired: accountingRequired === "Có",
    });
  });
  if (!parsed.length || parsed.length > 200)
    errors.push({
      row: 1,
      column: "Dữ liệu",
      reason: "Mỗi lần nhập từ 1 đến 200 dòng.",
    });
  return { rows: parsed, errors };
}
