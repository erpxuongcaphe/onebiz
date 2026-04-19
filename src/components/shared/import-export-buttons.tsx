"use client";

/**
 * ImportExportButtons — Standard 3-button bar cho mỗi module
 *
 *   [Tải mẫu]  [Xuất Excel]  [Nhập Excel]
 *
 * Cả 3 nút dùng CÙNG `schema` để đảm bảo template/export/import consistent.
 *
 * Usage trong page:
 *   <ImportExportButtons
 *     schema={productSchema}
 *     exportData={products}
 *     onImport={async (rows) => {
 *       const { data, error } = await supabase.from("products").insert(rows);
 *       if (error) return { successCount: 0, failureCount: rows.length, errors: [...] };
 *       return { successCount: rows.length, failureCount: 0, errors: [] };
 *     }}
 *     onImported={() => refetch()}
 *   />
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  downloadTemplate,
  exportToExcelFromSchema,
  type ExcelSchema,
  type ImportBatchResult,
} from "@/lib/excel";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";

interface ImportExportButtonsProps<TRow> {
  schema: ExcelSchema<TRow>;
  /** Dữ liệu hiện có để Export */
  exportData: TRow[];
  /** Callback insert data → DB */
  onImport: (validRows: TRow[]) => Promise<ImportBatchResult>;
  /** Refresh data sau khi import xong */
  onImported?: () => void;
  /** Ẩn / hiện từng nút (default: all visible) */
  showTemplate?: boolean;
  showExport?: boolean;
  showImport?: boolean;
  /** Size button — default "sm" cho phù hợp toolbar */
  size?: "xs" | "sm" | "default";
  /** Disable nút Import (VD khi user chưa chọn chi nhánh) */
  importDisabled?: boolean;
  importDisabledReason?: string;
}

export function ImportExportButtons<TRow>({
  schema,
  exportData,
  onImport,
  onImported,
  showTemplate = true,
  showExport = true,
  showImport = true,
  size = "sm",
  importDisabled = false,
  importDisabledReason,
}: ImportExportButtonsProps<TRow>) {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        {showTemplate && (
          <Button
            variant="ghost"
            size={size}
            onClick={() => downloadTemplate(schema)}
            title={`Tải file mẫu ${schema.name} để điền dữ liệu`}
          >
            <Icon name="description" size={14} className="mr-1" />
            Tải mẫu
          </Button>
        )}

        {showExport && (
          <Button
            variant="outline"
            size={size}
            onClick={() => exportToExcelFromSchema(exportData, schema)}
            disabled={exportData.length === 0}
            title={
              exportData.length === 0
                ? "Không có dữ liệu để xuất"
                : `Xuất ${exportData.length} dòng ${schema.name} ra Excel`
            }
          >
            <Icon name="download" size={14} className="mr-1" />
            Xuất Excel
          </Button>
        )}

        {showImport && (
          <Button
            variant="default"
            size={size}
            onClick={() => setImportOpen(true)}
            disabled={importDisabled}
            title={
              importDisabled
                ? importDisabledReason ?? "Không thể nhập lúc này"
                : `Nhập ${schema.name} từ file Excel`
            }
          >
            <Icon name="upload" size={14} className="mr-1" />
            Nhập Excel
          </Button>
        )}
      </div>

      {showImport && (
        <ImportExcelDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          schema={schema}
          onCommit={onImport}
          onFinished={onImported}
        />
      )}
    </>
  );
}
