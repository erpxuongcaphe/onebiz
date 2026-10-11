"use client";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  revenueHeaders,
  validateRevenueRows,
  type ImportIssue,
  type RevenueImportRow,
} from "@/lib/operations/revenue-import";
import { formatNumber } from "@/lib/format";
import type { Branch } from "@/lib/operations/contracts";

export function RevenueExcel({
  branch,
  definition,
  period,
  busy,
  onSave,
}: {
  branch: Branch;
  definition: string;
  period: string;
  busy: boolean;
  onSave: (action: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [rows, setRows] = useState<RevenueImportRow[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [reading, setReading] = useState(false);
  const [requests, setRequests] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const download = async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...revenueHeaders],
      [
        branch.code,
        `${period.slice(5)}/${period.slice(0, 4)}`,
        "",
        "",
        definition,
        "",
        "",
      ],
    ]);
    sheet["!cols"] = [20, 18, 20, 28, 60, 40, 24].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, "Doanh thu");
    XLSX.writeFile(workbook, "OneBiz_Mau_Doanh_thu.xlsx");
  };
  return (
    <section>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => void download()}>
          <Icon name="download" size={16} />
          Tải mẫu doanh thu
        </button>
        <button
          type="button"
          disabled={busy || reading}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="upload" size={16} />
          Nhập XLSX
        </button>
        <input
          ref={fileInput}
          hidden
          aria-label="File doanh thu XLSX"
          type="file"
          accept=".xlsx"
          disabled={busy || reading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            setRows([]);
            setIssues([]);
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setIssues([
                { row: 1, column: "File", message: "File tối đa 2 MB." },
              ]);
              return;
            }
            setReading(true);
            try {
              const XLSX = await import("xlsx");
              const book = XLSX.read(await file.arrayBuffer(), {
                type: "array",
                cellFormula: true,
                sheetRows: 102,
              });
              if (book.SheetNames.length !== 1)
                throw new Error("File phải có đúng một sheet doanh thu.");
              const sheet = book.Sheets[book.SheetNames[0]];
              const fullRange = sheet["!fullref"] ?? sheet["!ref"];
              if (fullRange && XLSX.utils.decode_range(fullRange).e.r > 100)
                throw new Error(
                  "File tối đa 100 dòng dữ liệu; không được bỏ qua các dòng nằm ngoài vùng xem trước.",
                );
              if (
                Object.values(sheet).some(
                  (cell) => cell && typeof cell === "object" && "f" in cell,
                )
              )
                throw new Error(
                  "Không dùng công thức Excel; cần số liệu đã đối chiếu.",
                );
              const result = validateRevenueRows(
                XLSX.utils.sheet_to_json<unknown[]>(sheet, {
                  header: 1,
                  defval: "",
                  raw: true,
                }),
                branch,
              );
              setIssues(result.issues);
              setRows(result.rows);
              setRequests(result.rows.map(() => crypto.randomUUID()));
            } catch (error) {
              setIssues([
                {
                  row: 1,
                  column: "File",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Không đọc được file.",
                },
              ]);
            } finally {
              setReading(false);
            }
          }}
        />
      </div>
      {reading && <p role="status">Đang kiểm tra file…</p>}
      {issues.length > 0 && (
        <div role="alert">
          {issues.map((issue, index) => (
            <p key={index}>
              Dòng {issue.row} · {issue.column}: {issue.message}
            </p>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table
              style={{ width: "100%", marginTop: 12, overflowWrap: "anywhere" }}
            >
              <thead>
                <tr>
                  <th>Kỳ</th>
                  <th>Nguồn</th>
                  <th style={{ textAlign: "right" }}>Doanh thu</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      {row.period.slice(5)}/{row.period.slice(0, 4)}
                    </td>
                    <td>{row.sourceName}</td>
                    <td style={{ textAlign: "right" }}>
                      {formatNumber(row.amountCents / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            disabled={busy || reading}
            onClick={async () => {
              await onSave("revenue_batch", {
                rows: rows.map((row, i) => ({
                  ...row,
                  requestId: requests[i],
                })),
              });
            }}
          >
            Gửi {rows.length} dòng chờ duyệt
          </button>
        </>
      )}
    </section>
  );
}
