/**
 * Excel/CSV export — lazy-loaded để giữ initial bundle gọn.
 *
 * Sprint POLISH-3.1: trước đây `import * as XLSX from "xlsx"` ở top-level
 * khiến gói xlsx (~400KB raw) bị bundle vào 19 list page (mỗi page có nút
 * Export). Sau khi đổi sang `await import("xlsx")` trong function body, xlsx
 * chỉ load khi user thực sự nhấn Export — initial JS giảm đáng kể.
 *
 * Async API: caller phải `await exportToExcel(...)`. Dialog/button thường
 * đã có loading state nên không block UX.
 */

interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format?: (value: any) => string | number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportToExcel<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn[],
  fileName: string,
): Promise<void> {
  // Lazy import — xlsx chỉ tải khi function thực sự được gọi.
  const [{ default: XLSX }, { saveAs }] = await Promise.all([
    import("xlsx"),
    import("file-saver"),
  ]);

  // Map data to rows using column definitions
  const rows = data.map((item) =>
    columns.reduce(
      (acc, col) => {
        const value = item[col.key];
        acc[col.header] = col.format ? col.format(value) : value;
        return acc;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as Record<string, any>,
    ),
  );

  const ws = XLSX.utils.json_to_sheet(rows);

  // Set column widths
  ws["!cols"] = columns.map((col) => ({ wch: col.width || 15 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");

  const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  saveAs(blob, `${fileName}.xlsx`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function exportToCsv<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn[],
  fileName: string,
): Promise<void> {
  const [{ default: XLSX }, { saveAs }] = await Promise.all([
    import("xlsx"),
    import("file-saver"),
  ]);

  const rows = data.map((item) =>
    columns.reduce(
      (acc, col) => {
        const value = item[col.key];
        acc[col.header] = col.format ? col.format(value) : value;
        return acc;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as Record<string, any>,
    ),
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }); // BOM for Vietnamese
  saveAs(blob, `${fileName}.csv`);
}
