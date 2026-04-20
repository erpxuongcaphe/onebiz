"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useSettings } from "@/lib/contexts";
import type { PaperSize } from "@/lib/print-document";

interface PaperSizeOption {
  id: PaperSize;
  label: string;
  desc: string;
  icon: string;
}

const OPTIONS: PaperSizeOption[] = [
  { id: "A4", label: "A4", desc: "Giấy A4 — tài liệu đầy đủ", icon: "description" },
  { id: "A5", label: "A5", desc: "Giấy A5 — tài liệu gọn, tiết kiệm giấy", icon: "article" },
  { id: "80mm", label: "80mm", desc: "Máy in bill tiêu chuẩn", icon: "receipt_long" },
  { id: "58mm", label: "58mm", desc: "Máy in bill nhỏ", icon: "receipt" },
];

interface PrintSizePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title hiển thị (ví dụ "In hóa đơn", "In phiếu nhập"). Default "Chọn cỡ giấy in". */
  title?: string;
  /** Callback khi user chọn cỡ và bấm "In ngay". */
  onPrint: (paperSize: PaperSize) => void;
}

/**
 * Dialog chọn cỡ giấy trước khi in. Preselect cỡ từ Settings (Cài đặt → In ấn).
 * User có thể đổi 1-lần mà không ảnh hưởng cài đặt mặc định.
 */
export function PrintSizePickerDialog({
  open,
  onOpenChange,
  title = "Chọn cỡ giấy in",
  onPrint,
}: PrintSizePickerDialogProps) {
  const { settings } = useSettings();
  const defaultSize = (settings?.print?.paperSize ?? "A4") as PaperSize;
  const [selected, setSelected] = useState<PaperSize>(defaultSize);

  useEffect(() => {
    if (open) setSelected(defaultSize);
  }, [open, defaultSize]);

  const handlePrint = () => {
    onPrint(selected);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Cỡ giấy mặc định lấy từ Cài đặt → In ấn. Bạn có thể đổi lại tạm thời
            cho lần in này.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 py-2">
          {OPTIONS.map((opt) => {
            const isActive = selected === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSelected(opt.id)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-all",
                  isActive
                    ? "border-primary bg-primary-fixed ring-2 ring-primary/20"
                    : "border-outline-variant bg-surface hover:bg-surface-container-low"
                )}
              >
                <Icon
                  name={opt.icon}
                  size={24}
                  className={isActive ? "text-primary" : "text-muted-foreground"}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        isActive ? "text-primary" : "text-on-surface"
                      )}
                    >
                      {opt.label}
                    </span>
                    {opt.id === defaultSize && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Mặc định
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button type="button" onClick={handlePrint}>
            <Icon name="print" size={16} className="mr-1.5" />
            In ngay ({selected})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
