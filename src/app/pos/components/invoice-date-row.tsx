"use client";

/**
 * InvoiceDateRow — dòng "Ngày hoá đơn" trên POS Retail (00335 Pha B).
 *
 * Mặc định: KHÔNG gửi ngày lên máy chủ → máy chủ tự lấy giờ lúc thanh toán.
 * Dòng này chỉ HIỂN THỊ giờ hiện tại kèm chữ "(tự động)" cho thu ngân biết
 * hoá đơn sẽ mang ngày nào.
 *
 * Chỉnh tay: chỉ hiện nút Sửa khi có quyền `invoices.adjust_issued_at`.
 * Máy chủ vẫn kiểm lại quyền + lý do + tháng hiện tại và ghi audit — phần
 * kiểm ở đây chỉ để báo lỗi sớm cho người dùng, KHÔNG phải lớp bảo vệ.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** ISO → chuỗi cho <input type="datetime-local"> theo GIỜ MÁY (local). */
function isoSangOInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function hienThi(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface InvoiceDateRowProps {
  /** null = để máy chủ tự lấy giờ lúc thanh toán (đường thường). */
  value: string | null;
  reason: string;
  onChange: (iso: string | null, lyDo: string) => void;
  /** Có quyền invoices.adjust_issued_at hay không. */
  canEdit: boolean;
}

export function InvoiceDateRow({ value, reason, onChange, canEdit }: InvoiceDateRowProps) {
  const [moHop, setMoHop] = useState(false);
  const [nhapNgay, setNhapNgay] = useState("");
  const [nhapLyDo, setNhapLyDo] = useState("");
  const [loi, setLoi] = useState<string | null>(null);
  // Đồng hồ hiển thị khi ĐANG ở chế độ tự động — cập nhật mỗi 30 giây để thu
  // ngân luôn thấy đúng giờ hoá đơn sắp mang.
  //
  // ⚠️ KHỞI TẠO null, KHÔNG lấy new Date() ngay: trang POS được dựng sẵn trên
  // máy chủ rồi mới hydrate ở trình duyệt — giờ hai lần dựng khác nhau sẽ làm
  // React báo lệch hydrate (#418, đã nổ thật trên production 20/08). Chỉ đọc
  // đồng hồ SAU khi đã mount.
  const [gioHienTai, setGioHienTai] = useState<string | null>(null);

  useEffect(() => {
    setGioHienTai(new Date().toISOString());
    if (value) return;
    const t = setInterval(() => setGioHienTai(new Date().toISOString()), 30_000);
    return () => clearInterval(t);
  }, [value]);

  const daChinh = value !== null;
  // Trước khi mount xong, phần giờ để trống — dựng trên máy chủ và hydrate ở
  // trình duyệt ra CÙNG một chuỗi nên không lệch.
  const ngayHienThi = useMemo(() => {
    if (daChinh) return hienThi(value!);
    return gioHienTai ? hienThi(gioHienTai) : "—";
  }, [daChinh, value, gioHienTai]);

  function moDialog() {
    setNhapNgay(isoSangOInput(value ?? new Date().toISOString()));
    setNhapLyDo(reason);
    setLoi(null);
    setMoHop(true);
  }

  function xacNhan() {
    if (!nhapNgay) {
      setLoi("Chưa chọn ngày giờ.");
      return;
    }
    const chon = new Date(nhapNgay);
    if (Number.isNaN(chon.getTime())) {
      setLoi("Ngày giờ không hợp lệ.");
      return;
    }
    const now = new Date();
    if (chon.getTime() > now.getTime() + 5 * 60 * 1000) {
      setLoi("Không được chọn thời điểm ở tương lai quá 5 phút.");
      return;
    }
    if (
      chon.getMonth() !== now.getMonth() ||
      chon.getFullYear() !== now.getFullYear()
    ) {
      setLoi("Chỉ được chỉnh trong tháng hiện tại.");
      return;
    }
    if (!nhapLyDo.trim()) {
      setLoi("Bắt buộc nhập lý do chỉnh ngày.");
      return;
    }
    onChange(chon.toISOString(), nhapLyDo.trim());
    setMoHop(false);
  }

  function veTuDong() {
    onChange(null, "");
    setMoHop(false);
  }

  return (
    <>
      <div className="flex items-center gap-2 mt-1.5 px-1 text-[11px]">
        <Icon
          name="event"
          size={13}
          className={cn("shrink-0", daChinh ? "text-status-warning" : "text-muted-foreground")}
        />
        <span className="text-muted-foreground shrink-0">Ngày hoá đơn:</span>
        <span
          className={cn(
            "font-semibold tabular-nums whitespace-nowrap",
            daChinh ? "text-status-warning" : "text-foreground",
          )}
        >
          {ngayHienThi}
        </span>
        {daChinh ? (
          <span className="text-status-warning/80 truncate" title={reason}>
            (đã chỉnh)
          </span>
        ) : (
          <span className="text-muted-foreground/70">(tự động)</span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={moDialog}
            className="ml-auto shrink-0 px-1.5 py-0.5 rounded text-primary hover:bg-primary-fixed transition-colors"
            title="Chỉnh ngày hoá đơn"
          >
            Sửa
          </button>
        )}
      </div>

      <Dialog open={moHop} onOpenChange={setMoHop}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Chỉnh ngày hoá đơn</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Chỉ dùng khi cần ghi hoá đơn theo đúng ngày bán thực tế. Mọi lần
              chỉnh đều được ghi nhật ký kèm người thực hiện và lý do.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium">Ngày và giờ</label>
              <input
                type="datetime-local"
                value={nhapNgay}
                onChange={(e) => setNhapNgay(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">
                Lý do <span className="text-status-error">*</span>
              </label>
              <textarea
                value={nhapLyDo}
                onChange={(e) => setNhapLyDo(e.target.value)}
                rows={2}
                placeholder="Ví dụ: máy tính tiền treo, ghi lại hoá đơn bán chiều qua"
                className="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm resize-none"
              />
            </div>
            {loi && (
              <p className="text-xs text-status-error font-medium">{loi}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            {daChinh && (
              <Button variant="ghost" onClick={veTuDong}>
                Dùng giờ hệ thống
              </Button>
            )}
            <Button variant="outline" onClick={() => setMoHop(false)}>
              Huỷ
            </Button>
            <Button onClick={xacNhan}>Áp dụng</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
