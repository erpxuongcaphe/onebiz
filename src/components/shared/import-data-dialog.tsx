"use client";

// ---------------------------------------------------------------------------
// ImportDataDialog — Quick Import (M3 placeholder)
// - Mở từ Top Header "Import dữ liệu"
// - Phase 1: chỉ nhận file Excel/CSV và đẩy vào AI queue (mock)
// - Phase 1.5: AI parse → preview → confirm tạo records
// - Hiện tại chỉ là khung UI để verify Header v2
// ---------------------------------------------------------------------------

import { useState, type ChangeEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

interface ImportDataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportDataDialog({ open, onOpenChange }: ImportDataDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) setFile(f);
  };

  const handleClose = () => {
    setFile(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon name="upload" />
          </div>
          <div className="flex-1 min-w-0">
            <DialogTitle>Import dữ liệu cho AI</DialogTitle>
            <DialogDescription className="mt-1">
              Tải file Excel / CSV để AI phân tích và tự động cập nhật vào hệ thống.
            </DialogDescription>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "mt-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:bg-muted/50"
          )}
        >
          {file ? (
            <div className="flex items-center justify-center gap-3">
              <Icon name="table_view" size={32} className="text-emerald-600" />
              <div className="text-left">
                <p className="text-sm font-medium truncate max-w-[280px]">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="ml-2 h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center"
                aria-label="Xóa file"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : (
            <>
              <Icon name="upload" size={32} className="mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Kéo thả file vào đây</p>
              <p className="text-xs text-muted-foreground mt-1">
                Hỗ trợ Excel (.xlsx, .xls) và CSV
              </p>
              <label className="mt-3 inline-flex items-center gap-2 cursor-pointer text-xs font-medium text-primary hover:underline">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                hoặc chọn file từ máy
              </label>
            </>
          )}
        </div>

        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
          <strong>Sắp ra mắt:</strong> AI Agent sẽ tự động phát hiện schema, map cột,
          và preview diff trước khi cập nhật. Hiện tại tính năng đang trong giai đoạn
          phát triển — file upload chưa được xử lý.
        </div>

        <div className="flex justify-end gap-2 mt-1">
          <Button variant="outline" onClick={handleClose}>
            Hủy
          </Button>
          <Button disabled={!file} onClick={handleClose}>
            <Icon name="upload" size={16} className="mr-1.5" />
            Upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
