import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

interface ExportColumn {
  header: string;
  key: string;
  width?: number;
  format?: (value: any) => string | number;
}

export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn[],
  fileName: string
) {
  // Map data to rows using column definitions
  const rows = data.map((item) =>
    columns.reduce((acc, col) => {
      const value = item[col.key];
      acc[col.header] = col.format ? col.format(value) : value;
      return acc;
    }, {} as Record<string, any>)
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

export function exportToCsv<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn[],
  fileName: string
) {
  const rows = data.map((item) =>
    columns.reduce((acc, col) => {
      const value = item[col.key];
      acc[col.header] = col.format ? col.format(value) : value;
      return acc;
    }, {} as Record<string, any>)
  );

  const ws = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }); // BOM for Vietnamese
  saveAs(blob, `${fileName}.csv`);
}
