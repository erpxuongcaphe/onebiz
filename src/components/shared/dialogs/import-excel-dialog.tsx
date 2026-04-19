"use client";

/**
 * ImportExcelDialog — Generic 3-step import dialog
 *
 * Dùng chung cho mọi module: Sản phẩm / Khách hàng / NCC / PO / Tồn kho / ...
 *
 * Flow:
 *   1. "upload"    → user kéo thả / chọn file → parse theo schema
 *   2. "preview"   → show OK/Lỗi count + bảng preview + chi tiết lỗi từng dòng
 *   3. "importing" → gọi onCommit(validRows) → show spinner
 *   4. "done"      → show successCount / failureCount
 *
 * 4 yêu cầu plan được bao phủ:
 *   - [x] Template + export cùng schema → user edit file export upload lại OK
 *   - [x] Validate đầy đủ: required/type/enum/min-max/pattern/unique (template-parser)
 *   - [x] Báo lỗi từng dòng rõ ràng tiếng Việt (errorRows.errors[])
 *   - [x] Preview + confirm trước khi commit (step "preview" ≠ "importing")
 */

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  downloadTemplate,
  parseExcelFile,
  type ExcelSchema,
  type ImportBatchResult,
  type ParsedRow,
  type ParseResult,
} from "@/lib/excel";

type Step = "upload" | "preview" | "importing" | "done";

interface ImportExcelDialogProps<TRow> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: ExcelSchema<TRow>;
  /** Callback khi user confirm → insert vào DB. Return result để show summary. */
  onCommit: (validRows: TRow[]) => Promise<ImportBatchResult>;
  /** Optional: gọi sau khi import xong và user đóng dialog — để parent refresh data */
  onFinished?: () => void;
}

export function ImportExcelDialog<TRow>({
  open,
  onOpenChange,
  schema,
  onCommit,
  onFinished,
}: ImportExcelDialogProps<TRow>) {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult<TRow> | null>(
    null
  );
  const [importResult, setImportResult] = useState<ImportBatchResult | null>(
    null
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setFile(null);
    setParseResult(null);
    setImportResult(null);
    setParseError(null);
    setSkipErrors(false);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleClose(openNext: boolean) {
    if (step === "importing") return; // block close khi đang commit
    if (!openNext) {
      const wasDone = step === "done";
      reset();
      onOpenChange(false);
      if (wasDone) onFinished?.();
      return;
    }
    onOpenChange(openNext);
  }

  async function handleFileChosen(f: File) {
    setFile(f);
    setParseError(null);
    try {
      const result = await parseExcelFile<TRow>(f, schema);
      setParseResult(result);
      setStep("preview");
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Không đọc được file: ${err.message}`
          : "Không đọc được file Excel"
      );
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFileChosen(f);
  }

  function handleSelect(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFileChosen(f);
  }

  async function handleConfirmImport() {
    if (!parseResult) return;
    const toCommit = parseResult.validRows;
    if (toCommit.length === 0) return;
    setStep("importing");
    try {
      const res = await onCommit(toCommit);
      setImportResult(res);
    } catch (err) {
      setImportResult({
        successCount: 0,
        failureCount: toCommit.length,
        errors: [
          {
            rowIndex: 0,
            message:
              err instanceof Error ? err.message : "Lỗi không xác định khi import",
          },
        ],
      });
    } finally {
      setStep("done");
    }
  }

  const hasErrors = (parseResult?.errorRows.length ?? 0) > 0;
  const hasTableErrors = (parseResult?.tableErrors.length ?? 0) > 0;
  const validCount = parseResult?.validRows.length ?? 0;
  const errorCount = parseResult?.errorRows.length ?? 0;
  const canConfirm =
    validCount > 0 &&
    !hasTableErrors &&
    (errorCount === 0 || skipErrors);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            <span className="inline-flex items-center gap-2">
              <Icon name="upload" size={18} />
              Nhập Excel: {schema.name}
            </span>
          </DialogTitle>
          <DialogDescription>
            {step === "upload" &&
              "Chọn file .xlsx / .xls / .csv đúng theo mẫu để nhập dữ liệu hàng loạt."}
            {step === "preview" &&
              "Xem trước dữ liệu + lỗi. Xác nhận để ghi vào hệ thống."}
            {step === "importing" && "Đang ghi dữ liệu, vui lòng chờ..."}
            {step === "done" && "Hoàn tất nhập Excel."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                "rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              )}
            >
              <Icon
                name="cloud_upload"
                size={40}
                className="mx-auto text-muted-foreground mb-2"
              />
              <p className="text-sm font-medium">Kéo thả file vào đây</p>
              <p className="text-xs text-muted-foreground mt-1">
                Hỗ trợ Excel (.xlsx, .xls) và CSV
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="folder_open" size={16} className="mr-1.5" />
                  Chọn file
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadTemplate(schema)}
                >
                  <Icon name="download" size={16} className="mr-1.5" />
                  Tải file mẫu
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleSelect}
              />
            </div>

            {parseError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/25 p-3 text-sm text-destructive">
                {parseError}
              </div>
            )}

            <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                Lưu ý khi nhập liệu:
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Tải file mẫu để có đúng tên cột và định dạng.</li>
                <li>
                  Cột bắt buộc không được để trống, sẽ bị báo lỗi khi upload.
                </li>
                <li>
                  Dữ liệu sẽ được kiểm tra từng dòng, bạn xem trước và xác nhận
                  mới ghi vào hệ thống.
                </li>
              </ul>
            </div>
          </div>
        )}

        {step === "preview" && parseResult && (
          <PreviewSection
            schema={schema}
            result={parseResult}
            file={file}
            skipErrors={skipErrors}
            onToggleSkipErrors={setSkipErrors}
            onBack={() => {
              reset();
            }}
          />
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Icon
              name="progress_activity"
              size={40}
              className="text-primary animate-spin"
            />
            <p className="text-sm text-muted-foreground">
              Đang ghi {validCount} dòng vào hệ thống...
            </p>
          </div>
        )}

        {step === "done" && importResult && (
          <DoneSection result={importResult} total={validCount} />
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Hủy
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset}>
                Chọn file khác
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={handleConfirmImport}
              >
                <Icon name="check" size={16} className="mr-1.5" />
                {errorCount > 0 && skipErrors
                  ? `Nhập ${validCount} dòng hợp lệ (bỏ qua ${errorCount} dòng lỗi)`
                  : `Xác nhận nhập ${validCount} dòng`}
              </Button>
            </>
          )}
          {step === "importing" && (
            <Button variant="outline" disabled>
              Đang xử lý...
            </Button>
          )}
          {step === "done" && (
            <Button onClick={() => handleClose(false)}>Đóng</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// PreviewSection — render bên trong dialog khi step = "preview"
// ---------------------------------------------------------------------------

interface PreviewSectionProps<TRow> {
  schema: ExcelSchema<TRow>;
  result: ParseResult<TRow>;
  file: File | null;
  skipErrors: boolean;
  onToggleSkipErrors: (v: boolean) => void;
  onBack: () => void;
}

function PreviewSection<TRow>({
  schema,
  result,
  file,
  skipErrors,
  onToggleSkipErrors,
}: PreviewSectionProps<TRow>) {
  const { validRows, errorRows, tableErrors, totalRows } = result;
  const validCount = validRows.length;
  const errorCount = errorRows.length;
  const maxShow = 50;

  return (
    <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {file && (
          <span className="text-muted-foreground">
            <Icon name="description" size={14} className="inline mr-1" />
            {file.name}
          </span>
        )}
        <Badge variant="outline" className="bg-muted/40">
          Tổng {totalRows} dòng
        </Badge>
        <Badge className="bg-status-success/15 text-status-success border-status-success/30">
          <Icon name="check_circle" size={12} className="mr-1" />
          {validCount} hợp lệ
        </Badge>
        {errorCount > 0 && (
          <Badge className="bg-destructive/15 text-destructive border-destructive/30">
            <Icon name="error" size={12} className="mr-1" />
            {errorCount} lỗi
          </Badge>
        )}
      </div>

      {/* Table-level errors (thiếu cột...) */}
      {tableErrors.length > 0 && (
        <div className="rounded-md bg-destructive/10 border border-destructive/25 p-3 text-sm text-destructive space-y-1">
          <p className="font-medium">
            <Icon name="error" size={14} className="inline mr-1" />
            Lỗi cấp file — không thể import:
          </p>
          <ul className="list-disc pl-5 text-xs">
            {tableErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Error rows detail */}
      {errorCount > 0 && (
        <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-destructive">
              <Icon name="error" size={14} className="inline mr-1" />
              Danh sách dòng lỗi ({errorCount})
            </p>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-muted-foreground">
              <input
                type="checkbox"
                checked={skipErrors}
                onChange={(e) => onToggleSkipErrors(e.target.checked)}
                className="rounded"
              />
              Bỏ qua dòng lỗi, chỉ nhập {validCount} dòng hợp lệ
            </label>
          </div>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {errorRows.slice(0, 100).map((row) => (
              <ErrorRowItem key={row.rowIndex} row={row} />
            ))}
            {errorRows.length > 100 && (
              <p className="text-xs text-muted-foreground italic">
                ... và {errorRows.length - 100} dòng lỗi khác
              </p>
            )}
          </div>
        </div>
      )}

      {/* Preview valid rows */}
      {validCount > 0 && (
        <div className="border rounded-md overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground flex items-center justify-between">
            <span>
              Xem trước {Math.min(maxShow, validCount)} / {validCount} dòng hợp lệ
            </span>
            {validCount > maxShow && (
              <span className="italic">
                (chỉ hiển thị {maxShow} dòng đầu, toàn bộ sẽ được nhập)
              </span>
            )}
          </div>
          <div className="max-h-[240px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  {schema.columns.map((c) => (
                    <TableHead key={c.key}>{c.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {validRows.slice(0, maxShow).map((row, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    {schema.columns.map((c) => {
                      const v = (row as Record<string, unknown>)[c.key];
                      return (
                        <TableCell
                          key={c.key}
                          className="text-xs max-w-[200px] truncate"
                        >
                          {formatCellForPreview(v)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {validCount === 0 && errorCount === 0 && tableErrors.length === 0 && (
        <div className="rounded-md bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          File không có dòng dữ liệu nào.
        </div>
      )}
    </div>
  );
}

function ErrorRowItem<TRow>({ row }: { row: ParsedRow<TRow> }) {
  return (
    <div className="text-xs border-l-2 border-destructive/60 pl-2">
      <p className="font-medium">Dòng {row.rowIndex}</p>
      <ul className="text-destructive/90 list-disc pl-4">
        {row.errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

function formatCellForPreview(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "boolean") return v ? "Có" : "Không";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------------------
// DoneSection — render khi step = "done"
// ---------------------------------------------------------------------------

function DoneSection({
  result,
  total,
}: {
  result: ImportBatchResult;
  total: number;
}) {
  const allOk = result.failureCount === 0;
  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-md border p-4 flex items-start gap-3",
          allOk
            ? "bg-status-success/10 border-status-success/30"
            : "bg-status-warning/10 border-status-warning/30"
        )}
      >
        <Icon
          name={allOk ? "check_circle" : "warning"}
          size={24}
          className={allOk ? "text-status-success" : "text-status-warning"}
        />
        <div className="flex-1">
          <p className="font-medium text-sm">
            {allOk
              ? `Nhập thành công ${result.successCount} / ${total} dòng`
              : `Nhập ${result.successCount} / ${total} dòng thành công — ${result.failureCount} dòng lỗi`}
          </p>
          {!allOk && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Những dòng lỗi đã được rollback, dữ liệu còn lại được ghi nhận.
            </p>
          )}
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="rounded-md bg-destructive/5 border border-destructive/20 p-3 max-h-48 overflow-y-auto">
          <p className="text-xs font-medium text-destructive mb-1">Chi tiết lỗi:</p>
          <ul className="text-xs space-y-1">
            {result.errors.map((e, i) => (
              <li key={i}>
                {e.rowIndex > 0 && (
                  <span className="font-medium">Dòng {e.rowIndex}: </span>
                )}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
