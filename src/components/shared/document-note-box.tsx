"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Ô ghi chú trong panel chi tiết chứng từ.
 *
 * 06/08/2026 — CEO phát hiện trên HD001512: ghi chú lưu ĐÚNG trong cột
 * invoices.note, bản in hiện đúng, nhưng 4 màn chi tiết (hóa đơn / đặt hàng /
 * trả hàng / phiếu nhập) cùng đặt một <textarea> trần không gắn value →
 * không bao giờ hiện ghi chú đã lưu; tệ hơn: không có handler lưu nên nhân
 * viên gõ vào TƯỞNG đã lưu mà nội dung bị nuốt mất.
 *
 * Nguyên tắc: mặc định CHỈ HIỂN THỊ. Chỉ màn nào có đường lưu hợp lệ
 * (hóa đơn nháp → RPC update_draft_invoice_atomic, vốn chặn completed/paid)
 * mới truyền `editable` + `onSave`.
 */
export function DocumentNoteBox({
  note,
  editable = false,
  onSave,
}: {
  note?: string | null;
  /** Chỉ bật khi chứng từ còn được phép sửa trường mềm (vd HĐ nháp, chưa thu tiền). */
  editable?: boolean;
  onSave?: (note: string) => Promise<void>;
}) {
  const saved = note ?? "";
  const [value, setValue] = useState(saved);
  const [busy, setBusy] = useState(false);

  // Panel chi tiết tái dùng cùng instance khi bấm sang dòng khác → đồng bộ lại.
  useEffect(() => {
    setValue(saved);
  }, [saved]);

  if (!editable) {
    return (
      <div className="border rounded-lg p-3">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Ghi chú</div>
        {saved ? (
          <div className="text-sm whitespace-pre-line break-words">{saved}</div>
        ) : (
          <div className="text-sm text-muted-foreground">Không có ghi chú</div>
        )}
      </div>
    );
  }

  const changed = value.trim() !== saved.trim();

  return (
    <div className="space-y-2 border rounded-lg p-3">
      <div className="text-xs font-medium text-muted-foreground">Ghi chú</div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ghi chú..."
        className="min-h-[60px] w-full resize-none bg-transparent text-sm outline-none"
      />
      {changed && (
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setValue(saved)}
          >
            Hủy
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave?.(value.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Đang lưu..." : "Lưu ghi chú"}
          </Button>
        </div>
      )}
    </div>
  );
}
